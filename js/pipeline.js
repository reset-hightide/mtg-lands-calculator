/*
 * Do template Excel (ou lista colada) até o resultado por deck.
 * Sem DOM nem rede: recebe a função `getCard(nome)` que devolve a carta do Scryfall (ou undefined).
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./rules.js'));
  else root.Pipeline = factory(root.Rules);
})(typeof self !== 'undefined' ? self : this, function (Rules) {
  'use strict';

  const fold = s => String(s == null ? '' : s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim();
  const blank = v => v === '' || v === null || v === undefined || (typeof v === 'string' && v.trim() === '');
  const isAuto = v => blank(v) || fold(v) === 'auto' || fold(v) === 'automatico';

  // ------------------------------------------------------------------ leitura das planilhas
  function findSheet(sheets, ...keys) {
    for (const name of Object.keys(sheets)) if (keys.includes(fold(name))) return sheets[name];
    return null;
  }

  /** Mapeia o cabeçalho (1ª linha) para índices de coluna. */
  function headerMap(row, aliases) {
    const map = {};
    row.forEach((h, i) => {
      const f = fold(h);
      for (const [key, names] of Object.entries(aliases)) if (names.includes(f) && !(key in map)) map[key] = i;
    });
    return map;
  }

  const CARD_COLS = { deck: ['deck', 'baralho', 'nome do deck'], qty: ['quantidade', 'qtd', 'qty', 'qt', 'copias', 'q'], card: ['carta', 'card', 'nome', 'name', 'carta (nome em ingles)'], section: ['secao', 'section', 'zona', 'local'] };
  const DECK_COLS = { deck: ['deck', 'baralho', 'nome do deck'], archetype: ['arquetipo', 'archetype'], size: ['tamanho', 'size', 'tamanho do deck', 'cartas'], companion: ['companion', 'companheiro'], colors: ['cores', 'colors', 'cor'] };

  function sectionOf(v) {
    const f = fold(v);
    if (!f || /^(main|maindeck|principal|deck|mainboard)$/.test(f)) return 'main';
    if (/^(side|sideboard|sb|reserva|banco)$/.test(f)) return 'side';
    if (/^(companion|companheiro)$/.test(f)) return 'companion';
    return null;
  }

  /**
   * sheets: { nome: linhas[][] } (saída de XlsxLite.readXlsx ou parseCsv).
   * -> { decks: [{ name, params, main: Map, side: Map, companionSection }], warnings: [] }
   */
  function decksFromSheets(sheets) {
    const warnings = [];
    const cardsRows = findSheet(sheets, 'cartas', 'cards', 'lista') || Object.values(sheets)[Object.keys(sheets).length > 1 ? 1 : 0] || [];
    const decksRows = findSheet(sheets, 'decks', 'parametros', 'baralhos') || [];
    const decks = new Map();   // nome -> deck
    const ensure = name => {
      if (!decks.has(name)) decks.set(name, { name, params: {}, main: new Map(), side: new Map(), companionSection: false });
      return decks.get(name);
    };

    // 1) parâmetros por deck
    if (decksRows.length) {
      const h = headerMap(decksRows[0], DECK_COLS);
      if (h.deck === undefined) warnings.push('A aba "Decks" não tem a coluna "Deck"; usando só a aba "Cartas".');
      else for (const r of decksRows.slice(1)) {
        if (blank(r[h.deck])) continue;
        const d = ensure(String(r[h.deck]).trim());
        d.params = {
          archetype: h.archetype !== undefined ? r[h.archetype] : '', size: h.size !== undefined ? r[h.size] : '',
          companion: h.companion !== undefined ? r[h.companion] : '', colors: h.colors !== undefined ? r[h.colors] : '',
        };
      }
    }

    // 2) cartas
    if (!cardsRows.length) throw new Error('Não encontrei a aba "Cartas" (ou ela está vazia).');
    const h = headerMap(cardsRows[0], CARD_COLS);
    if (h.card === undefined) throw new Error('A aba "Cartas" precisa de uma coluna chamada "Carta" na primeira linha.');
    let current = null, ignored = 0;
    cardsRows.slice(1).forEach((r, idx) => {
      const rawName = r[h.card];
      if (blank(rawName)) return;
      if (h.deck !== undefined && !blank(r[h.deck])) current = String(r[h.deck]).trim();
      if (!current) current = decks.size === 1 ? [...decks.keys()][0] : 'Deck 1';
      const deck = ensure(current);
      let qty = h.qty !== undefined && !blank(r[h.qty]) ? Number(String(r[h.qty]).replace(/x/i, '').replace(',', '.')) : NaN;
      let name = String(rawName).trim();
      if (!Number.isFinite(qty)) {   // "4 Lightning Bolt" numa única coluna
        const m = name.match(/^(\d+)\s*x?\s+(.+)$/i);
        if (m) { qty = parseInt(m[1], 10); name = m[2]; } else qty = 1;
      }
      const dec = Rules.splitDecorations(name);
      name = dec.name;
      const catSection = Rules.sectionFromCategories(dec.categories);
      if (!(qty > 0) || qty > 250 || !Number.isInteger(qty)) { warnings.push(`Linha ${idx + 2} da aba Cartas ignorada: quantidade inválida (“${r[h.qty]}”).`); return; }
      if (catSection === 'ignore') { ignored += qty; return; }   // Maybeboard / fora do deck no Archidekt
      const sec = catSection || (h.section !== undefined ? sectionOf(r[h.section]) : 'main');
      if (sec === null) { warnings.push(`Linha ${idx + 2} da aba Cartas: seção “${r[h.section]}” não reconhecida (use Main ou Side); tratada como Main.`); }
      const section = sec || 'main';
      const target = section === 'main' ? deck.main : deck.side;
      target.set(name, (target.get(name) || 0) + qty);
      if (section === 'companion') deck.companionSection = true;
    });
    if (ignored) warnings.push(`${ignored} carta(s) marcadas como Maybeboard/fora do deck foram ignoradas.`);
    if (!decks.size) throw new Error('Nenhuma carta encontrada na aba "Cartas".');
    return { decks: [...decks.values()], warnings };
  }

  /** Converte uma lista colada (texto) em um deck. */
  function deckFromText(text, name, params) {
    const p = Rules.parseDeck(text);
    return { name: name || 'Meu deck', params: params || {}, main: p.main, side: p.side, companionSection: p.companionSection, ignored: p.ignored, rawText: text };
  }

  const allNames = decks => [...new Set(decks.flatMap(d => [...d.main.keys(), ...d.side.keys()]))];

  // ------------------------------------------------------------------ avaliação de um deck
  function spellColors(entries) {
    const set = new Set();
    for (const e of entries) {
      if (e.cls.isLand) continue;
      const c = e.card;
      const cols = c.card_faces && c.layout !== 'modal_dfc' ? c.card_faces.flatMap(f => f.colors || []) : (c.card_faces ? c.card_faces[0].colors || [] : c.colors || []);
      cols.forEach(x => set.add(x));
    }
    return 'WUBRG'.split('').filter(c => set.has(c)).join('');
  }

  function evaluateDeck(deck, getCard) {
    const warnings = [];
    const missing = [];
    const entries = [];
    // cartas que o usuário tirou da contagem de compra/aceleração: texto de regras neutralizado
    const ex = deck.excluded;
    const neutral = c => ({ ...c, oracle_text: '', card_faces: c.card_faces && c.card_faces.map(f => ({ ...f, oracle_text: '' })) });
    const lookup = n => { const c = getCard(n); return c && ex && ex.has(c.name) ? neutral(c) : c; };
    for (const [name, qty] of deck.main) {
      const card = lookup(name);
      if (!card) { missing.push(name); continue; }
      entries.push({ name, qty, card });
    }
    const agg = Rules.analyzeEntries(entries);
    const mainTotal = [...deck.main.values()].reduce((a, b) => a + b, 0);
    const p = deck.params || {};

    // tamanho
    let size = Number(p.size), sizeSource = 'informado';
    if (isAuto(p.size) || !Number.isFinite(size)) { size = Rules.guessSize(mainTotal); sizeSource = 'pelo total de cartas'; }
    else if (!Rules.SIZES.includes(size)) { warnings.push(`Tamanho ${p.size} não é 40/60/100: a fórmula foi escalada proporcionalmente (N/60), sem validação.`); }
    if (mainTotal && Math.abs(mainTotal - size) > 2 && size !== 100) warnings.push(`O main deck tem ${mainTotal} cartas, mas o tamanho considerado é ${size}.`);

    // arquétipo
    const cabText = [...deck.main.keys(), ...deck.side.keys()].join('\n');
    let archetype = null, archetypeSource = 'informado';
    if (!isAuto(p.archetype)) {
      archetype = Rules.ARCHETYPES.find(a => fold(a) === fold(p.archetype)) || null;
      if (!archetype) warnings.push(`Arquétipo “${p.archetype}” não reconhecido; usando sugestão automática.`);
    }
    if (!archetype) { archetype = Rules.suggestArchetype(deck.name, cabText, agg.pureLands); archetypeSource = 'sugerido pelas regras do TCC'; }

    // companion
    let companion, companionSource = 'informado';
    if (isAuto(p.companion)) {
      const bySide = [...deck.side.keys()].some(n => { const c = getCard(n); return c && (c.keywords || []).includes('Companion'); });
      companion = deck.companionSection || bySide; companionSource = 'detectado no sideboard';
    } else companion = ['sim', 's', 'yes', 'y', 'true', '1'].includes(fold(p.companion));

    // cores
    let colors = Rules.normalizeColors(p.colors), colorsSource = 'informado';
    const noColors = ['nenhuma', 'nenhum', '-', '0', 'incolor', 'none'].includes(fold(p.colors));
    if (!noColors && (isAuto(p.colors) || !colors)) {
      if (!isAuto(p.colors) && !colors) warnings.push(`Cores “${p.colors}” não reconhecidas; usando detecção automática.`);
      const t = Rules.tccColors(' ' + deck.name + ' ', cabText, true);
      if (t.colors) { colors = t.colors; colorsSource = t.source === 'nome' ? 'nome do deck' : 'terrenos básicos'; }
      else { colors = spellColors(agg.cards); colorsSource = 'cores das mágicas'; }
    }
    if (!colors) warnings.push('Nenhuma cor detectada (deck incolor?). O modelo foi treinado com decks de pelo menos 1 cor.');

    if (!entries.length) {
      return { name: deck.name, ok: false, error: 'Nenhuma carta do main deck foi reconhecida.', missing, warnings };
    }
    if (deck.ignored) warnings.push(`${deck.ignored} carta(s) marcadas como Maybeboard/fora do deck foram ignoradas.`);
    if (missing.length) warnings.push(`${missing.length} carta(s) não encontrada(s) no Scryfall e ignoradas: ${missing.join(', ')}.`);

    const inputs = { cmc: agg.cmc, draw: agg.draw, ramp: agg.ramp, companion, colors: colors.length, archetype, size };
    const pred = Rules.predict(inputs);
    const rmse = Rules.MODEL.testRmse;
    const info = Rules.sourcesInfo(agg.cards);
    const sources = { lands: Math.round(pred.lands), totalPips: info.totalPips, rows: Rules.requiredSources(info, Math.round(pred.lands), size) };
    return {
      name: deck.name, ok: true, inputs, colorsList: colors, size, sizeSource, archetype, archetypeSource, companion, companionSource, colorsSource,
      cmc: agg.cmc, draw: agg.draw, ramp: agg.ramp, mainTotal, pureLands: agg.pureLands, currentLands: agg.currentLands,
      nonmythic: agg.nonmythic, mythic: agg.mythic,
      lands: pred.lands, rounded: Math.round(pred.lands), karsten: pred.karsten, low: pred.lands - rmse, high: pred.lands + rmse,
      delta: pred.lands - agg.currentLands, cards: agg.cards, sources, missing, warnings,
    };
  }

  return { decksFromSheets, deckFromText, allNames, evaluateDeck, sectionOf, fold };
});
