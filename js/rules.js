/*
 * Núcleo de regras da calculadora de terrenos (sem DOM, roda no navegador e no Node).
 *
 *  - MODEL / predict ........ equações (12)–(20) do TCC (Penatti & Costa, 2026)
 *  - classifyCard ........... regras de "compra barata" e "aceleração barata" (Karsten, 2022)
 *  - suggestArchetype ....... port das fórmulas de arquétipo usadas no Excel do TCC (coluna V)
 *  - tccColors .............. port da fórmula de cores do Excel do TCC (coluna W)
 *  - parseDeck / analyzeDeck  leitura da lista e agregação das variáveis do modelo
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Rules = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // ------------------------------------------------------------------ modelo
  const ARCHETYPES = ['Aggro', 'Combo', 'Control', 'Lands', 'Midrange', 'Ramp', 'Tempo'];

  const MODEL = {
    b0: 20.2185, cmc: 1.4316, draw: -0.2283, ramp: -0.2304,
    companion: 0.0364, colors: 0.6391,
    arch:  { Aggro: 0.0937, Combo: -2.1148, Control: 0.3099, Lands: 12.6260, Midrange: 0, Ramp: 4.4410, Tempo: -0.3831 },
    inter: { Aggro: -0.6748, Combo: 0.7114, Control: -0.2602, Lands: -3.0869, Midrange: 0, Ramp: -1.1077, Tempo: -0.2844 },
    // erro de teste (5% hold-out, 1.965 decks) do TCC, tabela 2
    testRmse: 1.789366, testMae: 1.313389,
  };
  const MDFC_WEIGHT = { nonmythic: 0.38, mythic: 0.74 };   // Karsten (2022)
  const SIZES = [40, 60, 100];

  /** Terrenos recomendados. size = 40 | 60 | 100 (ou qualquer N: escala proporcional, eq. 16). */
  function predict(p) {
    const M = MODEL;
    if (!(p.archetype in M.arch)) throw new Error('Arquétipo inválido: ' + p.archetype);
    const comp = p.companion ? 1 : 0;
    const z = M.companion * comp + M.colors * p.colors + M.arch[p.archetype] + M.inter[p.archetype] * p.colors;
    const base = M.b0 + M.cmc * p.cmc + z;
    const k = p.size / 60;
    const lands = k * base + M.draw * p.draw + M.ramp * p.ramp;
    // Karsten (2022), 60 cartas: 19.59 + 1.90*CMC - 0.28*(draw+ramp) + 0.27*companion; mesma escala
    const karsten = k * (19.59 + 1.90 * p.cmc + 0.27 * comp) - 0.28 * (p.draw + p.ramp);
    return { lands, karsten, z, base, k };
  }

  // ------------------------------------------------------------------ regras de carta (Karsten, 2022)
  const DRAW_PHRASES = ['draw a card', 'draw two cards', 'draw three cards', 'draws cards', 'draws two cards', 'draws three cards'];

  function frontFace(card) { return card.card_faces && card.card_faces[0] ? card.card_faces[0] : card; }
  function frontType(card) { return frontFace(card).type_line || card.type_line || ''; }

  /** Texto de regras usado na classificação. MDFC: só a face mágica (a face terreno produz mana e distorceria). */
  function oracleFor(card) {
    const f = card.card_faces;
    if (!f || !f.length) return card.oracle_text || '';
    if (card.layout === 'modal_dfc') return f[0].oracle_text || '';
    return f.map(x => x.oracle_text || '').join('\n');
  }

  function isCheapDraw(t, creature) {
    let draw = DRAW_PHRASES.some(p => t.includes(p)) && !t.includes('{4}') && !t.includes('blood token') && !t.includes('investigate');
    if (draw && creature && !(t.includes('when') && t.includes('enters'))) draw = false;
    if (!draw && !creature && ['look', 'library', 'put', 'your hand'].every(w => t.includes(w)) && !t.includes('pay ') && !t.includes('pays')) draw = true;
    if (!draw && /cycling \{1\}(?!\{)/.test(t)) draw = true;   // "cycles for one mana"
    return draw;
  }

  function isCheapRamp(t, creature) {
    const r1 = t.includes('add ') && !t.includes('add its ability') && !t.includes('add a lore counter') && !(creature && t.includes('dies'));
    const r2 = t.includes('search') && t.includes('your library') && (t.includes('land') || t.includes('basic')) && !t.includes('sacrifice');
    const r3 = t.includes('enchanted land is tapped') && t.includes('adds an additional');
    const r4 = t.includes('put a creature card with') && t.includes('from your hand onto the battlefield');
    return r1 || r2 || r3 || r4;
  }

  /**
   * Classifica uma carta do Scryfall.
   * -> { isLand, mdfc: null|'nonmythic'|'mythic', cmc, draw, ramp }
   */
  function classifyCard(card) {
    const type = frontType(card);
    const faces = card.card_faces || [];
    const out = { isLand: type.includes('Land'), mdfc: null, cmc: card.cmc || 0, draw: false, ramp: false };
    if (out.isLand) return out;
    const backIsLand = card.layout === 'modal_dfc' && faces[1] && (faces[1].type_line || '').includes('Land');
    if (backIsLand) out.mdfc = card.rarity === 'mythic' ? 'mythic' : 'nonmythic';
    // Carta com uma face terreno (MDFC ou transform, ex.: Tangled Florahedron, Search for Azcanta) nunca conta como
    // compra/aceleração barata: no Karsten o type_line completo contém "Land" e a carta não é "nonland".
    if (faces.some(f => (f.type_line || '').includes('Land'))) return out;
    if (out.cmc > 2) return out;
    const t = oracleFor(card).toLowerCase();
    const creature = type.includes('Creature');
    out.draw = isCheapDraw(t, creature);
    out.ramp = !out.draw && isCheapRamp(t, creature);
    return out;
  }

  // ------------------------------------------------------------------ arquétipo e cores (Excel do TCC)
  const A = {
    nameLands:   ['lands', 'sultai lands', '4c lands', 'temur lands', 'jund lands'],
    nameTempo:   ['tempo', 'flash', 'rogues', 'delver', 'murktide', 'spirits'],
    nameAggro:   ['aggro', 'stompy', 'mono-red', 'mono red', 'mono-green', 'mono green', 'mono-black', 'mono black', 'goblins'],
    nameMid:     ['midrange', 'sacrifice', 'jund sacrifice', 'rakdos sacrifice', 'gruul midrange', 'sultai midrange', 'temur midrange'],
    nameRamp:    ['ramp', 'ultimatum', 'elementals', 'omnath ramp', 'temur ramp', 'simic ramp', 'bant festival'],
    nameCombo:   ['combo', 'reclamation', 'reanimator', 'storm', 'belcher', 'neoform', 'creativity'],
    nameControl: ['control', 'yorion control', 'simic control', 'sultai control', 'dimir control', 'esper control', 'bant ninjas'],
    cardsLands:  ['life from the loam', 'exploration', 'crop rotation', 'dark depths', "thespian's stage", 'field of the dead', 'valakut', 'mox diamond'],
    cardsCombo:  ['wilderness reclamation', 'expansion // explosion', "thassa's oracle", 'underworld breach', 'grindstone', "painter's servant", 'phyrexian dreadnought', 'stifle', 'neoform', 'lotus field'],
    cardsRamp:   ['growth spiral', 'cultivate', 'arboreal grazer', "uro, titan of nature's wrath", 'nissa, who shakes the world', 'ugin, the spirit dragon', 'genesis ultimatum', 'hydroid krasis'],
    cardsControl:['shatter the sky', 'extinction event', 'elspeth conquers death', 'neutralize', "dovin's veto", 'shark typhoon', 'teferi, time raveler', 'narset, parter of veils'],
    cardsTempo:  ['spectral sailor', 'nightpack ambusher', 'frilled mystic', 'soaring thought-thief', "thieves' guild enforcer", 'delver of secrets', 'sprite dragon', 'murktide regent', 'brazen borrower', 'quench'],
    cardsAggro:  ['embercleave', 'fervent champion', 'anax, hardened in the forge', 'robber of the rich', 'pelt collector', 'scorch spitter', 'monastery swiftspear', 'light up the stage', 'questing beast'],
    cardsMid:    ['mayhem devil', 'trail of crumbs', 'korvold, fae-cursed king', 'fiend artisan', 'bonecrusher giant', 'elder gargaroth', 'fable of the mirror-breaker', "jolrael, mwonvuli recluse"],
  };
  const countFound = (list, text) => list.reduce((n, s) => n + (text.includes(s) ? 1 : 0), 0);

  /**
   * Reproduz a cascata de IFs da coluna "Archetype" do Excel do TCC.
   * topo = nome do deck (no Excel: primeiros 400 caracteres do cabeçalho); cab = lista inteira; lands = terrenos puros.
   */
  function suggestArchetype(topo, cab, lands) {
    topo = topo.toLowerCase(); cab = cab.toLowerCase();
    const n = {};
    for (const k of Object.keys(A)) n[k] = countFound(A[k], k.startsWith('name') ? topo : cab);
    if (n.nameLands > 0) return 'Lands';
    if (n.nameTempo > 0) return 'Tempo';
    if (n.nameAggro > 0) return 'Aggro';
    if (n.nameMid > 0) return 'Midrange';
    if (n.nameRamp > 0) return 'Ramp';
    if (n.nameCombo > 0) return 'Combo';
    if (n.nameControl > 0) return 'Control';
    if (lands >= 34 || n.cardsLands >= 2) return 'Lands';
    if (n.cardsCombo >= 2) return 'Combo';
    if (n.cardsRamp >= 3 && lands >= 27) return 'Ramp';
    if (n.cardsControl >= 3 && lands >= 27) return 'Control';
    if (n.cardsTempo >= 2 && lands <= 26) return 'Tempo';
    if (n.cardsAggro >= 3 && lands <= 24) return 'Aggro';
    if (n.cardsMid >= 2 || (lands >= 24 && lands <= 27)) return 'Midrange';
    if (lands <= 22) return 'Aggro';
    if (lands >= 28) return 'Ramp';
    return 'Control';
  }

  // [palavras-chave do nome, cores], na mesma ordem de prioridade do Excel
  const COLOR_NAMES = [
    [['bant', 'wgu'], 'WGU'], [['esper', 'uwb'], 'UWB'], [['grixis', 'bru'], 'BRU'], [['jund', 'rbg'], 'RBG'],
    [['naya', 'grw'], 'GRW'], [['abzan', 'wbg'], 'WBG'], [['jeskai', 'urw'], 'URW'], [['sultai', 'bgu'], 'BGU'],
    [['mardu', 'rwb'], 'RWB'], [['temur', 'gru'], 'GRU'],
    [['azorius', 'azorio', ' uw ', ' wu '], 'WU'], [['dimir', ' ub ', ' bu '], 'UB'], [['rakdos', ' br ', ' rb '], 'BR'],
    [['gruul', ' rg ', ' gr '], 'RG'], [['selesnya', ' gw ', ' wg '], 'GW'], [['orzhov', ' wb ', ' bw '], 'WB'],
    [['izzet', ' ur ', ' ru '], 'UR'], [['golgari', ' bg ', ' gb '], 'BG'], [['boros', ' rw ', ' wr '], 'RW'],
    [['simic', ' gu ', ' ug '], 'GU'],
    [['mono-white', 'mono white', 'monowhite'], 'W'], [['mono-blue', 'mono blue', 'monoblue'], 'U'],
    [['mono-black', 'mono black', 'monoblack'], 'B'], [['mono-red', 'mono red', 'monored'], 'R'],
    [['mono-green', 'mono green', 'monogreen'], 'G'],
    [['glint', 'sans white', 'nonwhite', 'non-white'], 'UBRG'], [['dune', 'sans blue', 'nonblue', 'non-blue'], 'WBRG'],
    [['ink', 'sans black', 'nonblack', 'non-black'], 'WURG'], [['witch', 'sans red', 'nonred', 'non-red'], 'WUBG'],
    [['yore', 'sans green', 'nongreen', 'non-green'], 'WUBR'],
    [['five-color', 'five color', '5-color', '5 color', '5c'], 'WUBRG'],
  ];
  // abreviações curtas que aparecem dentro de palavras comuns ("ink" em "Blinkmoth"): exigem fronteira de palavra
  const RISKY = new Set(['bru', 'wgu', 'rbg', 'grw', 'wbg', 'urw', 'bgu', 'rwb', 'gru', 'uwb', 'ink', 'dune', 'witch', 'yore', '5c', 'bant', 'naya', 'jund']);
  function nameHas(topo, kw, strict) {
    if (!strict || !RISKY.has(kw)) return topo.includes(kw);
    return new RegExp('(^|[^a-z0-9])' + kw.replace(/[-]/g, '\\-') + '($|[^a-z0-9])').test(topo);
  }
  const BASICS = [['W', ['plains']], ['U', ['island']], ['B', ['swamp']], ['R', ['mountain']], ['G', ['forest']]];

  /**
   * Cores como no Excel do TCC: 1º pelo nome do deck; senão pelos terrenos básicos presentes na lista.
   * Retorna { colors: 'UBG', source: 'nome' | 'terrenos básicos' | '' }.
   */
  function tccColors(topo, cab, strict) {
    topo = topo.toLowerCase(); cab = cab.toLowerCase();
    for (const [kws, res] of COLOR_NAMES) if (kws.some(k => nameHas(topo, k, strict))) return { colors: res, source: 'nome' };
    const fb = BASICS.filter(([, names]) => names.some(n => cab.includes(n))).map(([c]) => c).join('');
    return { colors: fb, source: fb ? 'terrenos básicos' : '' };
  }

  // ------------------------------------------------------------------ leitura da lista
  /**
   * Remove decorações de exportação do nome da carta e devolve as categorias.
   * Archidekt: "1x Nome (set) 123 *F* [Ramp,Artifact] ^Buy,#0066ff^"; Arena: "Nome (SET) 123"; Moxfield: "Nome (SET) 123 *F*".
   * -> { name, categories: [{ name, flags: [] }] }
   */
  function splitDecorations(raw) {
    let s = String(raw).replace(/ /g, ' ').trim();
    const categories = [];
    s = s.replace(/\s*\^[^^]*\^\s*$/, '');                                     // ^Buy,#0066ff^ (tag de cor)
    for (let i = 0; i < 3; i++) {                                              // cada passo remove um bloco no fim; a ordem varia por app
      const before = s;
      s = s.replace(/\s*\[([^\]]*)\]\s*$/, (_, inner) => {                    // [Categoria{flag},Outra]
        for (const part of inner.split(',')) {
          const flags = [...part.matchAll(/\{([^}]*)\}/g)].map(m => m[1].toLowerCase());
          const name = part.replace(/\{[^}]*\}/g, '').trim();
          if (name || flags.length) categories.push({ name, flags });
        }
        return '';
      });
      s = s.replace(/\s*\*[A-Za-z]{1,3}\*\s*$/, '');                           // *F* (foil), *E* (etched)
      s = s.replace(/\s+\(([A-Za-z0-9]{2,6})\)(?:\s+[\w★†\-]+)?\s*$/, '');    // (M10) 123
      if (s === before) break;
    }
    return { name: s.replace(/\s+/g, ' ').trim(), categories };
  }

  /** Seção implícita pelas categorias do Archidekt: 'side' | 'companion' | 'ignore' (maybeboard / fora do deck) | null. */
  function sectionFromCategories(cats) {
    const names = cats.map(c => c.name.toLowerCase());
    if (names.includes('sideboard')) return 'side';
    if (names.includes('companion')) return 'companion';
    if (names.includes('commander')) return 'commander';
    if (names.includes('maybeboard') || cats.some(c => c.flags.includes('nodeck'))) return 'ignore';
    return null;
  }

  /**
   * Aceita Arena / MTGO / Moxfield / Archidekt / MTG Melee / texto livre.
   * -> { main: Map(nome -> qtd), side: Map, companionSection: bool, ignored: number }
   */
  function parseDeck(text) {
    const main = new Map(), side = new Map(), commanders = new Map();
    let section = 'main', explicit = false, seenMain = false, companionSection = false, ignored = 0;
    const add = (m, name, q) => m.set(name, (m.get(name) || 0) + q);
    for (const raw of String(text).split(/\r?\n/)) {
      const line = raw.replace(/ /g, ' ').trim();
      if (!line) { if (section === 'commander') section = 'main'; else if (!explicit && seenMain && section === 'main') section = 'side'; continue; }
      if (/^\/\//.test(line)) continue;                                        // comentários ("// Sideboard") de alguns exports
      const h = line.toLowerCase().replace(/:$/, '');
      if (/^(deck|main|maindeck|main deck)(\s*\(\d+\))?$/.test(h)) { section = 'main'; explicit = true; continue; }
      if (/^(sideboard|side)(\s*\(\d+\))?$/.test(h)) { section = 'side'; explicit = true; continue; }
      if (/^companion(\s*\(\d+\))?$/.test(h)) { section = 'companion'; explicit = true; continue; }
      if (/^commander(\s*\(\d+\))?$/.test(h)) { section = 'commander'; explicit = true; continue; }
      if (/^maybeboard(\s*\(\d+\))?$/.test(h)) { section = 'ignore'; explicit = true; continue; }
      // cabeçalhos de grupo por tipo ("Creature (16)", "Land (24)") encerram a seção Companion
      if (/^[a-z][a-z '\-]*\s*\(\d+\)$/.test(h)) { if (section === 'companion') section = 'main'; explicit = true; continue; }
      const m = line.match(/^(SB:\s*)?(\d+)\s*x?\s+(.+)$/i);
      if (!m) continue;
      const q = parseInt(m[2], 10);
      if (q > 250) continue;   // ex.: "2020 Season Grand Finals" (nome de evento), não é uma carta
      const { name, categories } = splitDecorations(m[3]);
      const target = m[1] ? 'side' : (sectionFromCategories(categories) || section);
      if (target === 'ignore') { ignored += q; continue; }
      if (target === 'side') add(side, name, q);
      else if (target === 'companion') { add(side, name, q); companionSection = true; }
      else if (target === 'commander') add(commanders, name, q);
      else { add(main, name, q); seenMain = true; }
    }
    if (!main.size && !side.size && !commanders.size) return parseNamesOnly(text);
    return { main, side, commanders, companionSection, ignored };
  }

  /** Lista sem quantidades (um nome de carta por linha): cada linha vale 1 cópia; repetidas somam. */
  function parseNamesOnly(text) {
    const main = new Map(), side = new Map(), commanders = new Map();
    const lines = String(text).split(/\r?\n/).map(l => l.replace(/\u00a0/g, ' ').trim()).filter(l => l && !/^\/\//.test(l));
    const header = /^(deck|main|maindeck|main deck|sideboard|side|companion|commander|maybeboard)(\s*\(\d+\))?:?$/i;
    const looksLikeName = l => l.length <= 60 && !/[.!?;]$/.test(l);
    const cards = lines.filter(l => !header.test(l));
    if (cards.length < 3 || cards.filter(looksLikeName).length / cards.length < 0.7) return { main, side, commanders, companionSection: false, ignored: 0 };
    let section = 'main', companionSection = false, ignored = 0, cmdLeft = 0;
    const add = (m, n) => m.set(n, (m.get(n) || 0) + 1);
    for (const l of lines) {
      const h = l.toLowerCase().replace(/:$/, '');
      if (header.test(l)) { section = /^(sideboard|side)/.test(h) ? 'side' : /^companion/.test(h) ? 'companion' : /^maybeboard/.test(h) ? 'ignore' : /^commander/.test(h) ? 'commander' : 'main'; cmdLeft = section === 'commander' ? 2 : 0; continue; }
      if (!looksLikeName(l)) continue;
      const { name, categories } = splitDecorations(l);
      const target = sectionFromCategories(categories) || section;
      if (target === 'ignore') { ignored++; continue; }
      if (target === 'commander') { add(commanders, name); if (--cmdLeft <= 0) section = 'main'; }
      else if (target === 'side') add(side, name); else if (target === 'companion') { add(side, name); companionSection = true; } else add(main, name);
    }
    return { main, side, commanders, companionSection, ignored };
  }

  function cleanName(s) { return splitDecorations(s).name; }

  // ------------------------------------------------------------------ agregação do deck
  /**
   * entries: [{ name, qty, card, commander }] do deck (card = objeto Scryfall)
   * -> variáveis do modelo + detalhes por carta.
   * Free spells (custo alternativo ou "cheatadas") custam 0 de mana: entram na média de custo (CMC) com valor 0, o que
   * diminui o número de terrenos recomendado. `opts.free` (Map nome -> bool) deixa o usuário corrigir a lista.
   */
  function analyzeEntries(entries, opts) {
    let sumCmc = 0, spells = 0, draw = 0, ramp = 0, pureLands = 0, mdfcLands = 0, nonmythic = 0, mythic = 0, total = 0;
    const cards = entries.map(e => ({ name: e.card.name, qty: e.qty, cls: classifyCard(e.card), card: e.card, commander: !!e.commander }));
    const free = freeSpellInfo(cards, opts && opts.free).names;
    for (const c of cards) {
      const cls = c.cls;
      total += c.qty;
      if (cls.isLand) { pureLands += c.qty; continue; }
      sumCmc += (free.has(c.name) ? 0 : cls.cmc) * c.qty; spells += c.qty;
      if (cls.draw) draw += c.qty;
      if (cls.ramp) ramp += c.qty;
      if (cls.mdfc === 'nonmythic') { nonmythic += c.qty; mdfcLands += c.qty * MDFC_WEIGHT.nonmythic; }
      if (cls.mdfc === 'mythic')    { mythic += c.qty;    mdfcLands += c.qty * MDFC_WEIGHT.mythic; }
    }
    return {
      cmc: spells ? sumCmc / spells : 0, draw, ramp, pureLands, nonmythic, mythic, total, spells,
      currentLands: pureLands + mdfcLands, cards, freeCount: [...free].reduce((a, n) => a + cards.filter(c => c.name === n).reduce((x, c) => x + c.qty, 0), 0),
    };
  }


  // ------------------------------------------------------------------ fontes de mana por cor (método dos pips)
  const COLORS = ['W', 'U', 'B', 'R', 'G'];
  // fontes mínimas para ter 2/3/4+ pips da mesma cor no turno 3 (tabela do post, faixa mín.–máx.)
  const MULTI_PIP_TABLE = {
    small: { 2: [14, 16], 3: [20, 20], 4: [23, 25] },   // 40 e 60 cartas
    big:   { 2: [22, 26], 3: [28, 30], 4: [32, 32] },   // 100 cartas ("32+")
  };
  const RAMP_CREDIT = { creature: 1 / 3, artifact: 2 / 3 };   // post: 0,33 / 0,66 (3 criaturas = 1 fonte; 1 criatura + 1 artefato = 1 fonte)

  function pipsOfCost(cost) {
    const p = { W: 0, U: 0, B: 0, R: 0, G: 0 };
    for (const m of String(cost || '').matchAll(/\{([^}]+)\}/g)) {
      const parts = m[1].split('/');
      const cols = parts.filter(x => x.length === 1 && COLORS.includes(x));
      if (!cols.length) continue;                    // genérico, X, incolor, neve
      if (cols.length >= 2) cols.forEach(c => { p[c] += 0.5; });   // híbrido {W/U}: meio pip de cada
      else p[cols[0]] += 1;                          // {W}, {2/W}, {W/P}
    }
    return p;
  }
  const frontCost = card => (card.card_faces && card.card_faces[0] ? card.card_faces[0].mana_cost : card.mana_cost) || '';
  /** Cores que a carta produz: topo da carta ou face escolhida. */
  function producedOf(card, faceIdx) {
    if (faceIdx != null) {   // o Scryfall costuma trazer produced_mana só no topo para MDFC
      const f = card.card_faces && card.card_faces[faceIdx];
      return (f && f.produced_mana) || card.produced_mana || [];
    }
    return card.produced_mana || (card.card_faces && card.card_faces[0] && card.card_faces[0].produced_mana) || [];
  }

  /**
   * Fetch land (Scalding Tarn, Verdant Catacombs, Evolving Wilds...): busca um terreno e puxa a cor que o deck precisar,
   * então conta como fonte das cinco cores (decisão do autor do trabalho). Terreno que não busca nada devolve [].
   */
  function fetchColors(card) {
    const t = oracleFor(card).toLowerCase();
    if (!/sacrifice/.test(t) || !/search your library for an? [^.]*? card/.test(t)) return [];
    return ['W', 'U', 'B', 'R', 'G'];
  }

  /**
   * Free spell por custo alternativo: dá para lançar sem pagar o custo de mana ("rather than pay this spell's mana cost":
   * Force of Will, Fireblast, Daze, Snuff Out, Gush...), evoke com exílio (Solitude, Fury...) ou "cast this spell without
   * paying its mana cost". Os símbolos de mana dessas cartas não entram na conta das fontes.
   */
  function isFreeSpell(card) {
    const t = oracleFor(card).toLowerCase();
    return /rather than pay (this spell's|its) mana cost/.test(t) || /you may cast this spell without paying its mana cost/.test(t)
      || ((card.keywords || []).includes('Evoke') && /evoke—exile/.test(t));
  }

  /**
   * "Cheat": carta que põe permanentes da mão no campo sem pagar (Show and Tell, Braids, Sneak Attack, Through the Breach,
   * Kaalia, Eureka, Elvish Piper...). Devolve o conjunto de tipos que ela libera, ou null se não é um cheat.
   */
  const CHEAT_RE = /put (?:up to [a-z]+ |an? |any number of |each |all )?([^.;:]*?)cards? from (?:your|their|a|that player's|an opponent's)? ?hand onto the battlefield/;
  const CHEAT_TYPES = ['artifact', 'creature', 'enchantment', 'land', 'planeswalker', 'battle'];
  function cheatTypes(card) {
    const m = oracleFor(card).toLowerCase().match(CHEAT_RE);
    if (!m) return null;
    const said = m[1];
    let types = /\bpermanent\b/.test(said) ? CHEAT_TYPES.slice() : CHEAT_TYPES.filter(x => said.includes(x));
    if (!types.length) types = ['creature'];                      // "Angel, Demon, or Dragon card": subtipos de criatura
    types = types.filter(x => x !== 'land');                      // pôr terreno não custa mana: não muda nada
    return types.length ? new Set(types) : null;
  }

  /**
   * Quais cartas do deck são free spells: (1) custo alternativo/evoke; (2) cartas "cheatadas": havendo um cheat no deck
   * (inclusive o comandante) que custa N, as cartas de CMC >= max(5, N + 1) dos tipos que ele libera entram de graça
   * (ex.: Braids custa 4, então cartas de custo 5+ saem de graça). `override` (Map nome -> bool) deixa o usuário corrigir.
   * -> { names: Set dos que ficam fora da conta, list: [{ name, qty, cmc, auto, on, by }], enablers: [{ name, cmc, types }] }
   */
  function freeSpellInfo(cards, override) {
    const enablers = [];
    for (const c of cards) {
      if (c.cls.isLand) continue;
      const types = cheatTypes(c.card);
      if (types) enablers.push({ name: c.name, cmc: c.cls.cmc, types: [...types] });
    }
    const names = new Set(), list = [];
    for (const c of cards) {
      if (c.cls.isLand) continue;
      let auto = false, by = null;
      if (isFreeSpell(c.card)) { auto = true; by = 'custo alternativo'; }
      else {
        const type = frontType(c.card).toLowerCase();
        for (const en of enablers) {
          if (en.name === c.name || c.cls.cmc < Math.max(5, en.cmc + 1)) continue;
          if (en.types.some(t => type.includes(t))) { auto = true; by = en.name; break; }
        }
      }
      const has = !!override && override.has(c.name);
      const on = has ? !!override.get(c.name) : auto;
      if (auto || has) list.push({ name: c.name, qty: c.qty, cmc: c.cls.cmc, auto, on, by });
      if (on) names.add(c.name);
    }
    return { names, list, enablers };
  }

  /**
   * cards: saída de analyzeEntries().cards. -> pips por cor, maior nº de pips da cor numa só carta, crédito de ramp
   * (criaturas 1/3 / artefatos 2/3 de fonte por cópia) e fontes já presentes nos terrenos.
   */
  function sourcesInfo(cards, opts) {
    const z = () => ({ W: 0, U: 0, B: 0, R: 0, G: 0 });
    const pips = z(), maxSingle = z(), rampCredit = z(), landSources = z();
    const free = freeSpellInfo(cards, opts && opts.free);
    for (const c of cards) {
      if (c.cls.isLand) {
        const prod = producedOf(c.card);
        const cols = prod.length ? prod : fetchColors(c.card);   // fetch land: fonte das cinco cores
        for (const col of cols) if (col in landSources) landSources[col] += c.qty;
        continue;
      }
      if (free.names.has(c.name)) continue;   // free spell: nem pips nem regra de pips múltiplos
      const cp = pipsOfCost(frontCost(c.card));
      for (const col of COLORS) {
        pips[col] += cp[col] * c.qty;
        maxSingle[col] = Math.max(maxSingle[col], Math.floor(cp[col]));
      }
      if (c.cls.mdfc) {   // face terreno do MDFC conta como fonte, com o mesmo peso de terreno
        const w = MDFC_WEIGHT[c.cls.mdfc];
        for (const col of producedOf(c.card, 1)) if (col in landSources) landSources[col] += c.qty * w;
        continue;
      }
      const type = frontType(c.card), t = oracleFor(c.card).toLowerCase();
      const prod = producedOf(c.card);
      if (prod.length && t.includes('{t}') && /\badd\b/.test(t)) {
        const credit = type.includes('Creature') ? RAMP_CREDIT.creature : type.includes('Artifact') ? RAMP_CREDIT.artifact : 0;
        for (const col of prod) if (col in rampCredit) rampCredit[col] += credit * c.qty;
      }
    }
    const totalPips = COLORS.reduce((a, col) => a + pips[col], 0);
    return { pips, totalPips, maxSingle, rampCredit, landSources, free };
  }

  /**
   * Fontes necessárias por cor: (pips da cor / total de pips) × terrenos, arredondado para cima; com pips múltiplos
   * (CC, CCC, CCCC) vale o maior entre o resultado e o mínimo da tabela. O crédito de ramp reduz o que os terrenos
   * precisam fornecer.
   */
  function requiredSources(info, lands, size) {
    const table = size > 80 ? MULTI_PIP_TABLE.big : MULTI_PIP_TABLE.small;
    const eps = 1e-9;
    return COLORS.filter(c => info.pips[c] > 0).map(c => {
      const share = info.pips[c] / info.totalPips;
      const byFormula = Math.ceil(share * lands - eps);
      const k = Math.min(4, info.maxSingle[c]);
      const range = k >= 2 ? table[k] : null;
      const cap = Math.max(1, Math.round(lands));   // não existem mais fontes do que terrenos
      const raw = range ? Math.max(byFormula, range[0]) : byFormula;
      const needed = Math.min(raw, cap), capped = raw > cap;
      const credit = info.rampCredit[c];
      return {
        color: c, pips: info.pips[c], share, byFormula, multiPip: k >= 2 ? k : 1, tableRange: range, needed, capped,
        rampCredit: credit, fromLands: Math.max(0, Math.ceil(needed - credit - eps)), current: info.landSources[c],
      };
    });
  }

  /**
   * Mão inicial: n cartas sorteadas sem reposição do main deck (respeitando as quantidades).
   * cards: [{ name, qty, cls, card }] (saída de analyzeEntries().cards). rng: () => [0,1) (injetável nos testes).
   * -> { hand: [carta], lands: nº de terrenos na mão }
   */
  function drawHand(cards, n, rng) {
    rng = rng || Math.random;
    const pool = [];
    for (const c of cards) if (!c.commander) for (let i = 0; i < c.qty; i++) pool.push(c);   // o comandante fica na zona de comando
    n = Math.min(n == null ? 7 : n, pool.length);
    for (let i = 0; i < n; i++) {   // Fisher–Yates parcial
      const j = i + Math.floor(rng() * (pool.length - i));
      [pool[i], pool[j]] = [pool[j], pool[i]];
    }
    const hand = pool.slice(0, n);
    return { hand, lands: hand.filter(c => c.cls.isLand).length };
  }

  /**
   * Chance exata (hipergeométrica) de cada quantidade de terrenos numa mão de n cartas, sem reposição.
   * total = cartas do deck, lands = terrenos puros do deck. -> array [P(0), P(1), ..., P(n)]
   */
  function handLandOdds(total, lands, n) {
    n = Math.min(n == null ? 7 : n, total);
    const comb = (a, k) => { if (k < 0 || k > a) return 0; let r = 1; for (let i = 1; i <= k; i++) r = r * (a - k + i) / i; return r; };
    const all = comb(total, n), out = [];
    for (let k = 0; k <= n; k++) out.push(all ? comb(lands, k) * comb(total - lands, n - k) / all : 0);
    return out;
  }

  /** 40 / 60 / 100 pelo total de cartas do main deck. */
  function guessSize(total) { return total <= 50 ? 40 : total <= 80 ? 60 : 100; }

  /** Cores de uma string 'UB', 'u b', 'azul,preto' -> 'BU' (ordem WUBRG). */
  function normalizeColors(s) {
    const t = String(s || '').toLowerCase().trim();
    const letters = t.replace(/[^a-z]/g, '');
    const set = new Set();
    if (letters && letters.length <= 5 && /^[wubrg]+$/.test(letters)) {
      letters.split('').forEach(c => set.add(c.toUpperCase()));
    } else {
      const names = { W: ['branco', 'white', 'plains'], U: ['azul', 'blue', 'island'], B: ['preto', 'black', 'swamp'], R: ['vermelho', 'red', 'mountain'], G: ['verde', 'green', 'forest'] };
      for (const w of t.split(/[^a-zà-ú]+/).filter(Boolean))
        for (const c of Object.keys(names)) if (names[c].includes(w)) set.add(c);
    }
    return 'WUBRG'.split('').filter(c => set.has(c)).join('');
  }

  return {
    ARCHETYPES, MODEL, MDFC_WEIGHT, SIZES, predict,
    classifyCard, oracleFor, suggestArchetype, tccColors, parseDeck, cleanName, splitDecorations, sectionFromCategories, analyzeEntries, guessSize, normalizeColors,
    pipsOfCost, sourcesInfo, requiredSources, isFreeSpell, freeSpellInfo, cheatTypes, fetchColors, drawHand, handLandOdds,
  };
});
