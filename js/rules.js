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
   * Aceita Arena / MTGO / Moxfield / MTG Melee / texto livre.
   * -> { main: Map(nome -> qtd), side: Map, companionSection: bool }
   */
  function parseDeck(text) {
    const main = new Map(), side = new Map();
    let section = 'main', explicit = false, seenMain = false, companionSection = false;
    const add = (m, name, q) => m.set(name, (m.get(name) || 0) + q);
    for (const raw of String(text).split(/\r?\n/)) {
      const line = raw.replace(/ /g, ' ').trim();
      if (!line) { if (!explicit && seenMain && section === 'main') section = 'side'; continue; }
      const h = line.toLowerCase().replace(/:$/, '');
      if (/^(deck|main|maindeck|main deck)(\s*\(\d+\))?$/.test(h)) { section = 'main'; explicit = true; continue; }
      if (/^(sideboard|side)(\s*\(\d+\))?$/.test(h)) { section = 'side'; explicit = true; continue; }
      if (/^companion(\s*\(\d+\))?$/.test(h)) { section = 'companion'; explicit = true; continue; }
      if (/^commander(\s*\(\d+\))?$/.test(h)) { section = 'main'; explicit = true; continue; }
      // cabeçalhos de grupo por tipo ("Creature (16)", "Land (24)") encerram a seção Companion
      if (/^[a-z][a-z '\-]*\s*\(\d+\)$/.test(h)) { if (section === 'companion') section = 'main'; explicit = true; continue; }
      const m = line.match(/^(SB:\s*)?(\d+)\s*x?\s+(.+)$/i);
      if (!m) continue;
      const name = cleanName(m[3]);
      const q = parseInt(m[2], 10);
      if (q > 250) continue;   // ex.: "2020 Season Grand Finals" (nome de evento), não é uma carta
      if (m[1] || section === 'side') add(side, name, q);
      else if (section === 'companion') { add(side, name, q); companionSection = true; }
      else { add(main, name, q); seenMain = true; }
    }
    return { main, side, companionSection };
  }

  function cleanName(s) {
    return s.replace(/\s+\([A-Za-z0-9]{2,6}\)\s*[\w★-]*\s*$/, '')   // "(M10) 123"
            .replace(/\s*\[[^\]]*\]\s*$/, '')                           // "[Foil]"
            .replace(/\s*\*[A-Za-z]+\*\s*$/, '')                        // "*F*"
            .replace(/\s+/g, ' ').trim();
  }

  // ------------------------------------------------------------------ agregação do deck
  /**
   * entries: [{ name, qty, card }] do main deck (card = objeto Scryfall)
   * -> variáveis do modelo + detalhes por carta
   */
  function analyzeEntries(entries) {
    let sumCmc = 0, spells = 0, draw = 0, ramp = 0, pureLands = 0, mdfcLands = 0, nonmythic = 0, mythic = 0, total = 0;
    const cards = [];
    for (const e of entries) {
      const cls = classifyCard(e.card);
      total += e.qty;
      cards.push({ name: e.card.name, qty: e.qty, cls, card: e.card });
      if (cls.isLand) { pureLands += e.qty; continue; }
      sumCmc += cls.cmc * e.qty; spells += e.qty;
      if (cls.draw) draw += e.qty;
      if (cls.ramp) ramp += e.qty;
      if (cls.mdfc === 'nonmythic') { nonmythic += e.qty; mdfcLands += e.qty * MDFC_WEIGHT.nonmythic; }
      if (cls.mdfc === 'mythic')    { mythic += e.qty;    mdfcLands += e.qty * MDFC_WEIGHT.mythic; }
    }
    return {
      cmc: spells ? sumCmc / spells : 0, draw, ramp, pureLands, nonmythic, mythic, total, spells,
      currentLands: pureLands + mdfcLands, cards,
    };
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
    classifyCard, oracleFor, suggestArchetype, tccColors, parseDeck, cleanName, analyzeEntries, guessSize, normalizeColors,
  };
});
