// node --test tests/
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const R = require('../js/rules.js');

const near = (a, b, eps = 1e-3) => assert.ok(Math.abs(a - b) < eps, `${a} != ${b} (±${eps})`);
// amostra de 400 decks (com nomes de jogadores): não é publicada; gere com tools/build_data.py a partir da planilha do TCC
const samplePath = path.join(__dirname, '..', 'data', 'validation_sample.json');
const sample = fs.existsSync(samplePath) ? JSON.parse(fs.readFileSync(samplePath, 'utf8')) : null;
const NEEDS = 'requer data/validation_sample.json (rode tools/build_data.py)';

// ---------------------------------------------------------------- modelo
test('equações escaladas do TCC (17), (18) e (20) para Midrange sem cores/companion', () => {
  const base = { draw: 0, ramp: 0, companion: false, colors: 0, archetype: 'Midrange' };
  near(R.predict({ ...base, cmc: 0, size: 40 }).lands, 13.4790, 1e-3);   // 40/60 * 20.2185
  near(R.predict({ ...base, cmc: 1, size: 40 }).lands, 13.4790 + 0.9544, 1e-3);
  near(R.predict({ ...base, cmc: 0, size: 60 }).lands, 20.2185, 1e-4);
  near(R.predict({ ...base, cmc: 0, size: 100 }).lands, 33.6975, 1e-3);
  near(R.predict({ ...base, cmc: 1, size: 100 }).lands, 33.6975 + 2.3860, 1e-3);
});

test('cheap draw/ramp NÃO são escalados com o tamanho do deck', () => {
  const p = { cmc: 2.5, companion: false, colors: 2, archetype: 'Aggro' };
  for (const size of [40, 60, 100]) {
    const a = R.predict({ ...p, draw: 0, ramp: 0, size }).lands;
    const b = R.predict({ ...p, draw: 3, ramp: 2, size }).lands;
    near(a - b, 0.2283 * 3 + 0.2304 * 2, 1e-9);
  }
});

test('coeficientes de arquétipo e interação com cores (tabela 1 do TCC)', () => {
  // efeito total das cores = coeficiente geral + modificador
  const total = a => R.MODEL.colors + R.MODEL.inter[a];
  near(total('Midrange'), 0.6391, 1e-4); near(total('Aggro'), -0.0357, 1e-4); near(total('Combo'), 1.3505, 1e-4);
  near(total('Control'), 0.3789, 1e-4); near(total('Lands'), -2.4478, 1e-4); near(total('Ramp'), -0.4686, 1e-4);
  near(total('Tempo'), 0.3547, 1e-4);
});

test('arquétipo inválido lança erro', () => {
  assert.throws(() => R.predict({ cmc: 2, draw: 0, ramp: 0, companion: false, colors: 1, archetype: 'Foo', size: 60 }));
});

test('modelo reproduz o desempenho do TCC na base inteira (R² ≈ 0,567, MAE ≈ 1,30)', () => {
  const lines = fs.readFileSync(path.join(__dirname, '..', 'data', 'decks.csv'), 'utf8').trim().split(/\r?\n/);
  const head = lines[0].split(','); const ix = n => head.indexOf(n);
  const ys = [], ps = [];
  for (const l of lines.slice(1)) {
    const c = l.split(',');   // sem vírgulas nos campos usados
    ys.push(+c[ix('lands_mdfc')]);
    ps.push(R.predict({
      cmc: +c[ix('cmc')], draw: +c[ix('cheap_draw')], ramp: +c[ix('cheap_ramp')], companion: c[ix('companion')] === '1',
      colors: +c[ix('n_colors')], archetype: c[ix('archetype')], size: 60,
    }).lands);
  }
  const mean = ys.reduce((a, b) => a + b, 0) / ys.length;
  const sst = ys.reduce((a, y) => a + (y - mean) ** 2, 0);
  const sse = ys.reduce((a, y, i) => a + (y - ps[i]) ** 2, 0);
  const mae = ys.reduce((a, y, i) => a + Math.abs(y - ps[i]), 0) / ys.length;
  assert.equal(ys.length, 39287);
  near(1 - sse / sst, 0.567, 0.003);
  near(mae, 1.304, 0.01);
});

// ---------------------------------------------------------------- regras de carta (mecânica, com cartas sintéticas)
const card = (o) => ({ name: 'X', cmc: 1, type_line: 'Instant', oracle_text: '', layout: 'normal', rarity: 'common', ...o });

test('compra barata: frases, exclusões e criaturas', () => {
  const c = o => R.classifyCard(card(o));
  assert.equal(c({ oracle_text: 'Draw a card.' }).draw, true);                                       // Opt-like
  assert.equal(c({ oracle_text: 'Draw two cards, then discard two cards.' }).draw, true);
  assert.equal(c({ oracle_text: 'Draw a card. Investigate.' }).draw, false);                        // investigate
  assert.equal(c({ oracle_text: 'Create a Blood token. Draw a card.' }).draw, false);               // blood token
  assert.equal(c({ oracle_text: 'Draw a card. {4}: do x' }).draw, false);                           // {4}
  assert.equal(c({ cmc: 3, oracle_text: 'Draw a card.' }).draw, false);                             // cmc > 2
  // criatura precisa de "when ... enters"
  assert.equal(c({ type_line: 'Creature — Elf', oracle_text: 'When X enters the battlefield, draw a card.' }).draw, true);
  assert.equal(c({ type_line: 'Creature — Elf', oracle_text: 'Whenever X attacks, draw a card.' }).draw, false);
  // não-criatura "look/library/put/your hand" (Brainstorm-like: sem "draw a card" literal)
  assert.equal(c({ oracle_text: 'Look at the top three cards of your library. Put one into your hand.' }).draw, true);
  assert.equal(c({ oracle_text: 'Look at the top card of your library. You may pay 2 life. Put it into your hand.' }).draw, false);
  // cycling por 1 mana
  assert.equal(c({ type_line: 'Sorcery', oracle_text: 'Cycling {1} ({1}, Discard this card: Draw a card.)' }).draw, true);
  assert.equal(c({ cmc: 2, oracle_text: 'Cycling {1}{R}' }).draw, false);
  // terrenos nunca contam
  assert.equal(c({ type_line: 'Land', oracle_text: 'Draw a card.' }).draw, false);
});

test('aceleração barata: add, busca de terreno, exclusões, e prioridade da compra', () => {
  const c = o => R.classifyCard(card(o));
  assert.equal(c({ type_line: 'Creature — Elf Druid', oracle_text: '{T}: Add {G}.' }).ramp, true);
  assert.equal(c({ type_line: 'Creature — Elf', oracle_text: 'When X dies, add {G}.' }).ramp, false);   // criatura + dies
  assert.equal(c({ type_line: 'Enchantment', oracle_text: 'Whenever you cast a spell, add its ability counter' }).ramp, false);
  assert.equal(c({ cmc: 2, type_line: 'Sorcery', oracle_text: 'Search your library for a basic land card, put it onto the battlefield tapped, then shuffle.' }).ramp, true);
  assert.equal(c({ cmc: 2, type_line: 'Sorcery', oracle_text: 'Sacrifice a land. Search your library for a basic land card.' }).ramp, false);
  // estilo Aether Vial: "put a creature card with ... from your hand onto the battlefield"
  assert.equal(c({ cmc: 2, type_line: 'Artifact', oracle_text: '{T}: You may put a creature card with mana value equal to the number of charge counters from your hand onto the battlefield.' }).ramp, true);
  assert.equal(c({ cmc: 2, type_line: 'Artifact', oracle_text: '{T}: You may put a creature card from your hand onto the battlefield.' }).ramp, false);
  // carta de compra não conta também como aceleração
  const both = c({ oracle_text: 'Draw a card. Add {R}.' });
  assert.equal(both.draw, true); assert.equal(both.ramp, false);
});

test('MDFC terreno/mágica: peso por raridade e uso só da face mágica', () => {
  const mdfc = rarity => card({
    name: 'Jwari Disruption // Jwari Ruins', layout: 'modal_dfc', rarity, cmc: 2, type_line: 'Instant // Land',
    card_faces: [
      { type_line: 'Instant', oracle_text: 'Counter target spell unless its controller pays {1}.' },
      { type_line: 'Land', oracle_text: '({T}: Add {U}.)' },
    ],
  });
  const a = R.classifyCard(mdfc('rare')), b = R.classifyCard(mdfc('mythic'));
  assert.equal(a.mdfc, 'nonmythic'); assert.equal(b.mdfc, 'mythic');
  assert.equal(a.isLand, false); assert.equal(a.ramp, false);   // a face terreno produz mana, mas não conta como ramp
  const landLand = card({ layout: 'modal_dfc', type_line: 'Land // Land', card_faces: [{ type_line: 'Land' }, { type_line: 'Land' }] });
  assert.equal(R.classifyCard(landLand).isLand, true);
  assert.equal(R.classifyCard(landLand).mdfc, null);
});

test('analyzeEntries: CMC só das mágicas (MDFC conta como mágica), terrenos fracionados', () => {
  const E = (name, qty, o) => ({ name, qty, card: card({ name, ...o }) });
  const mdfc = { layout: 'modal_dfc', rarity: 'rare', cmc: 2, type_line: 'Instant // Land', card_faces: [{ type_line: 'Instant', oracle_text: '' }, { type_line: 'Land', oracle_text: '' }] };
  const r = R.analyzeEntries([
    E('Forest', 20, { type_line: 'Basic Land — Forest', cmc: 0 }),
    E('Llanowar Elves', 4, { type_line: 'Creature — Elf', cmc: 1, oracle_text: '{T}: Add {G}.' }),
    E('Big', 4, { type_line: 'Creature', cmc: 5 }),
    E('Mdfc', 2, mdfc),
  ]);
  assert.equal(r.pureLands, 20); assert.equal(r.total, 30);
  near(r.cmc, (4 * 1 + 4 * 5 + 2 * 2) / 10, 1e-9);
  assert.equal(r.ramp, 4); assert.equal(r.draw, 0);
  near(r.currentLands, 20 + 2 * 0.38, 1e-9);
});

// ---------------------------------------------------------------- arquétipo e cores (port do Excel)
test('arquétipo: 100% de concordância com a coluna V do Excel (400 decks)', (t) => {
  if (!sample) return t.skip(NEEDS);
  let ok = 0; const bad = [];
  for (const d of sample) {
    const got = R.suggestArchetype(d.topo, d.cab, d.expected.lands);
    if (got === d.expected.archetype) ok++; else bad.push([d.url, got, d.expected.archetype]);
  }
  assert.equal(ok, sample.length, JSON.stringify(bad.slice(0, 5)));
});

test('cores (versão fiel): 100% de concordância com a coluna W do Excel', (t) => {
  if (!sample) return t.skip(NEEDS);
  let ok = 0; const bad = [];
  for (const d of sample) {
    const got = R.tccColors(d.topo, d.cab, false).colors;
    if (got === d.expected.colors) ok++; else bad.push([d.url, got, d.expected.colors]);
  }
  assert.equal(ok, sample.length, JSON.stringify(bad.slice(0, 5)));
});

test('cores (fronteira de palavra, só o nome do deck): diverge da versão fiel apenas por bugs do substring', (t) => {
  if (!sample) return t.skip(NEEDS);
  // O Excel do TCC procura as palavras-chave nos 400 primeiros caracteres do cabeçalho (inclui as primeiras cartas) e testa
  // "gru" (Temur) antes de "gruul": todo deck "Gruul" virava GRU. O modo estrito evita isso.
  let same = 0; const diff = [];
  for (const d of sample) {
    const nm = ' ' + d.name + ' ';
    const a = R.tccColors(nm, d.cab, false).colors, b = R.tccColors(nm, d.cab, true).colors;
    if (a === b) same++; else diff.push([d.name, a, b]);
  }
  assert.ok(diff.every(([n]) => /gruul/i.test(n)), JSON.stringify(diff.filter(([n]) => !/gruul/i.test(n)).slice(0, 5)));
  assert.ok(same / sample.length >= 0.9);
});

test('cores: nomes curtos dentro de palavras não disparam em modo estrito', () => {
  assert.equal(R.tccColors(' Blinkmoth Tron ', '4 mountain', true).colors, 'R');
  assert.equal(R.tccColors(' Blinkmoth Tron ', '4 mountain', false).colors, 'WURG');   // bug do substring original
  assert.equal(R.tccColors(' UW Control ', '', true).colors, 'WU');
  assert.equal(R.tccColors(' Temur Reclamation ', '', true).colors, 'GRU');
  assert.equal(R.tccColors(' Gruul Aggro ', '', true).colors, 'RG');
  assert.equal(R.tccColors(' Gruul Aggro ', '', false).colors, 'GRU');   // bug do original
});

// ---------------------------------------------------------------- parser
test('parser: totais do main e do sideboard batem com o cabeçalho do MTG Melee (400 decks)', (t) => {
  if (!sample) return t.skip(NEEDS);
  let ok = 0, considered = 0; const bad = [];
  for (const d of sample) {
    if (/Error Code: 401/.test(d.text)) continue;   // página de erro raspada junto com a base (ver data/README)
    const dk = +(/Deck: (\d+) cards/.exec(d.text) || [])[1], sb = +(/Sideboard: (\d+) cards/.exec(d.text) || [])[1];
    // o cabeçalho da página do Melee (nome do evento etc.) não faz parte da lista: começa depois de "Sideboard: N cards"
    const { main, side } = R.parseDeck(d.text.replace(/^[\s\S]*?Sideboard: \d+ cards\n/, ''));
    const m = [...main.values()].reduce((a, b) => a + b, 0), s = [...side.values()].reduce((a, b) => a + b, 0);
    considered++;
    if (m === dk && s === sb) ok++; else bad.push([d.url, m, dk, s, sb]);
  }
  assert.ok(ok / considered >= 0.99, JSON.stringify(bad.slice(0, 5)));
});

test('parser: formatos Arena, MTGO e cabeçalhos', () => {
  const arena = 'Deck\n4 Lightning Bolt (M10) 146\n20 Mountain (ANA) 62\n\nSideboard\n2 Smash to Smithereens (ELD) 144\n';
  const a = R.parseDeck(arena);
  assert.equal(a.main.get('Lightning Bolt'), 4); assert.equal(a.main.get('Mountain'), 20); assert.equal(a.side.get('Smash to Smithereens'), 2);
  const mtgo = '4 Opt\n4 Brainstorm\n\n2 Negate\nSB: 1 Dispel\n';
  const b = R.parseDeck(mtgo);
  assert.equal(b.main.size, 2); assert.equal(b.side.get('Negate'), 2); assert.equal(b.side.get('Dispel'), 1);
  const comp = R.parseDeck('Deck\n4 Opt\n\nCompanion\n1 Lurrus of the Dream-Den\n\nSideboard\n1 Negate');
  assert.equal(comp.companionSection, true); assert.equal(comp.side.get('Lurrus of the Dream-Den'), 1); assert.equal(comp.main.size, 1);
  const x = R.parseDeck('4x Fire // Ice\n1 Wear // Tear *F*');
  assert.equal(x.main.get('Fire // Ice'), 4); assert.equal(x.main.get('Wear // Tear'), 1);
  assert.equal(R.parseDeck('Sideboard (15)\n3 Negate').side.get('Negate'), 3);
});

test('normalizeColors e guessSize', () => {
  assert.equal(R.normalizeColors('ub'), 'UB'); assert.equal(R.normalizeColors('G, W'), 'WG');
  assert.equal(R.normalizeColors('azul preto'), 'UB'); assert.equal(R.normalizeColors(''), '');
  assert.equal(R.normalizeColors('WUBRG'), 'WUBRG');
  assert.equal(R.guessSize(40), 40); assert.equal(R.guessSize(60), 60); assert.equal(R.guessSize(75), 60); assert.equal(R.guessSize(100), 100);
});

// ---------------------------------------------------------------- Archidekt
test('Archidekt: linhas do export de texto (set, coleção, foil, categorias, tag de cor)', () => {
  const text = [
    '1x Sol Ring (c21) 263 [Ramp,Artifact] ^Buy,#0066ff^',
    '1x Command Tower (cmm) 421 *F* [Land]',
    '2x Lightning Bolt (m10) 146',
    "1x Atraxa, Praetors' Voice (cmm) 7 [Commander{top}]",
    '1x Fire // Ice (mh2) 290 [Removal{noPrice}]',
    '1x Jwari Disruption // Jwari Ruins (znr) 66a',
    '1x Brainstorm (mmq) 61 [Maybeboard{noDeck}{noPrice}]',
    '1x Shock (m21) 159 [Ideas{noDeck}]',
    '1x Rest in Peace (a25) 9 [Sideboard]',
    '1x Lurrus of the Dream-Den (iko) 226 [Companion]',
  ].join('\n');
  const p = R.parseDeck(text);
  assert.deepEqual([...p.main.entries()], [['Sol Ring', 1], ['Command Tower', 1], ['Lightning Bolt', 2], ['Fire // Ice', 1], ['Jwari Disruption // Jwari Ruins', 1]]);
  assert.deepEqual([...p.commanders.entries()], [["Atraxa, Praetors' Voice", 1]]);   // comandante fica à parte (zona de comando)
  assert.deepEqual([...p.side.entries()], [['Rest in Peace', 1], ['Lurrus of the Dream-Den', 1]]);
  assert.equal(p.ignored, 2); assert.equal(p.companionSection, true);
});

test('Archidekt/Moxfield: splitDecorations devolve nome limpo e categorias', () => {
  const d = R.splitDecorations('1x Sol Ring (c21) 263 *F* [Ramp{top},Artifact] ^Have,#37d67a^'.replace(/^1x /, ''));
  assert.equal(d.name, 'Sol Ring');
  assert.deepEqual(d.categories.map(c => c.name), ['Ramp', 'Artifact']);
  assert.deepEqual(d.categories[0].flags, ['top']);
  assert.equal(R.cleanName('Wear // Tear (dgm) 135 *E*'), 'Wear // Tear');
  assert.equal(R.cleanName("Urza's Saga (mh2) 259"), "Urza's Saga");
  assert.equal(R.cleanName('Plains'), 'Plains');
});

// ---------------------------------------------------------------- fontes de mana por cor
test('pips: custo de mana -> pips por cor (híbrido 0,5; {2/W} e Phyrexian valem 1; genérico/X ignorados)', () => {
  assert.deepEqual(R.pipsOfCost('{2}{W}{W}'), { W: 2, U: 0, B: 0, R: 0, G: 0 });
  assert.deepEqual(R.pipsOfCost('{G/U}{G/U}'), { W: 0, U: 1, B: 0, R: 0, G: 1 });
  assert.deepEqual(R.pipsOfCost('{2/W}{B/P}{X}{C}{S}{R}'), { W: 1, U: 0, B: 1, R: 1, G: 0 });
  assert.deepEqual(R.pipsOfCost(''), { W: 0, U: 0, B: 0, R: 0, G: 0 });
});

test('fontes: exemplo do post (28 pips azuis + 8 brancos, 20 terrenos -> 16 e 5 fontes)', () => {
  const info = { pips: { W: 8, U: 28, B: 0, R: 0, G: 0 }, totalPips: 36, maxSingle: { W: 1, U: 1, B: 0, R: 0, G: 0 }, rampCredit: { W: 0, U: 0, B: 0, R: 0, G: 0 }, landSources: { W: 0, U: 0, B: 0, R: 0, G: 0 } };
  const rows = R.requiredSources(info, 20, 60);
  assert.deepEqual(rows.map(r => [r.color, r.needed]), [['W', 5], ['U', 16]]);
  near(rows[1].byFormula, 16); near(28 / 36 * 20, 15.5556, 1e-3);
});

test('fontes: pips múltiplos usam a tabela (14–16 / 20 / 23–25; 100 cartas 22–26 / 28–30 / 32+) e crédito de ramp', () => {
  const mk = (maxU) => ({ pips: { W: 0, U: 20, B: 0, R: 10, G: 0 }, totalPips: 30, maxSingle: { W: 0, U: maxU, B: 0, R: 1, G: 0 }, rampCredit: { W: 0, U: 1, B: 0, R: 0, G: 0 }, landSources: { W: 0, U: 0, B: 0, R: 0, G: 0 } });
  const u = (maxU, lands, size) => R.requiredSources(mk(maxU), lands, size).find(r => r.color === 'U');
  assert.equal(u(2, 16, 40).needed, 14);          // fórmula daria 11; a tabela exige 14
  assert.deepEqual(u(2, 16, 40).tableRange, [14, 16]);
  assert.equal(u(3, 20, 60).needed, 20);
  assert.equal(u(4, 24, 60).needed, 23);          // fórmula 16 < 23
  assert.equal(u(4, 24, 60).fromLands, 22);       // 23 - 1 de ramp (3 criaturas), arredondado para cima
  assert.equal(u(2, 40, 100).needed, 27);         // fórmula 27 > mín. 22
  assert.equal(u(3, 40, 100).needed, 28);
  assert.equal(u(4, 40, 100).needed, 32);
  assert.equal(u(6, 24, 60).needed, 23);          // 4+ pips = linha de 4
  assert.equal(u(1, 24, 60).tableRange, null);
  // nunca mais fontes do que terrenos: a tabela pede 23 mas o deck só tem 20
  assert.equal(u(4, 20, 60).needed, 20); assert.equal(u(4, 20, 60).capped, true); assert.equal(u(4, 24, 60).capped, false);
});

test('sourcesInfo: pips x cópias, free spells fora da conta, ramp 0,33/0,66, fontes nos terrenos e MDFC', () => {
  const c = (name, o) => ({ name, qty: o.qty, cls: R.classifyCard(o.card), card: o.card });
  const card = o => ({ name: 'X', cmc: 2, type_line: 'Instant', oracle_text: '', layout: 'normal', rarity: 'common', mana_cost: '', keywords: [], ...o });
  const cards = [
    c('Counterspell', { qty: 4, card: card({ name: 'Counterspell', mana_cost: '{U}{U}' }) }),
    c('Lightning Bolt', { qty: 4, card: card({ name: 'Lightning Bolt', cmc: 1, mana_cost: '{R}' }) }),
    c('Force of Will', { qty: 4, card: card({ name: 'Force of Will', cmc: 5, mana_cost: '{3}{U}{U}', oracle_text: "You may pay 1 life and exile a blue card from your hand rather than pay this spell's mana cost." }) }),
    c('Fireblast', { qty: 4, card: card({ name: 'Fireblast', cmc: 6, mana_cost: '{4}{R}{R}', oracle_text: "You may sacrifice two Mountains rather than pay this spell's mana cost.\nFireblast deals 4 damage to any target." }) }),
    c('Birds', { qty: 3, card: card({ name: 'Birds of Paradise', cmc: 1, type_line: 'Creature — Bird', mana_cost: '{G}', oracle_text: '{T}: Add one mana of any color.', produced_mana: ['W', 'U', 'B', 'R', 'G'] }) }),
    c('Sol Ring', { qty: 1, card: card({ name: 'Sol Ring', cmc: 1, type_line: 'Artifact', mana_cost: '{1}', oracle_text: '{T}: Add {C}{C}.', produced_mana: ['C'] }) }),
    c('Mox Opal', { qty: 2, card: card({ name: 'Mox Opal', cmc: 0, type_line: 'Legendary Artifact', mana_cost: '{0}', oracle_text: '{T}: Add one mana of any color.', produced_mana: ['W', 'U', 'B', 'R', 'G'] }) }),
    c('Island', { qty: 10, card: card({ name: 'Island', cmc: 0, type_line: 'Basic Land — Island', produced_mana: ['U'] }) }),
    c('Mdfc', { qty: 2, card: card({ name: 'Mdfc', layout: 'modal_dfc', rarity: 'rare', type_line: 'Instant // Land', mana_cost: '', card_faces: [{ type_line: 'Instant', mana_cost: '{1}{G}', oracle_text: '' }, { type_line: 'Land', mana_cost: '', oracle_text: '', produced_mana: ['G'] }] }) }),
  ];
  const info = R.sourcesInfo(cards);
  near(info.pips.U, 8);                          // só Counterspell (4x2): Force of Will é free spell e não conta
  near(info.pips.R, 4); near(info.pips.G, 3 + 2);   // Lightning Bolt 4; Fireblast (free spell) não conta
  assert.equal(info.maxSingle.U, 2);             // Counterspell
  assert.equal(info.maxSingle.G, 1);
  assert.equal(R.isFreeSpell(cards[2].card), true); assert.equal(R.isFreeSpell(cards[3].card), true);
  near(info.rampCredit.G, 3 / 3 + 2 * 2 / 3); near(info.rampCredit.U, 3 / 3 + 2 * 2 / 3);
  assert.equal(info.rampCredit.W > 0, true);
  near(info.landSources.U, 10); near(info.landSources.G, 2 * 0.38);
  // Force of Will e Fireblast sozinhos não geram pips nem disparam a tabela de pips múltiplos
  const only = R.sourcesInfo([cards[2], cards[3]]);
  assert.equal(only.maxSingle.U, 0); assert.equal(only.maxSingle.R, 0); assert.equal(only.totalPips, 0);
});


test('fetch lands: toda fetch land conta como fonte das cinco cores', () => {
  const land = (name, text) => ({ name, type_line: 'Land', cmc: 0, layout: 'normal', rarity: 'rare', oracle_text: text, mana_cost: '', keywords: [] });
  const tarn = land('Scalding Tarn', '{T}, Pay 1 life, Sacrifice Scalding Tarn: Search your library for an Island or Mountain card, put it onto the battlefield, then shuffle.');
  const wilds = land('Evolving Wilds', '{T}, Sacrifice Evolving Wilds: Search your library for a basic land card, put it onto the battlefield tapped, then shuffle.');
  const five = ['B', 'G', 'R', 'U', 'W'];
  assert.deepEqual(R.fetchColors(tarn).sort(), five);
  assert.deepEqual(R.fetchColors(wilds).sort(), five);
  assert.deepEqual(R.fetchColors(land('Island', '({T}: Add {U}.)')), []);
  const cards = [tarn, wilds].map((card, i) => ({ name: card.name, qty: i ? 3 : 4, cls: R.classifyCard(card), card }));
  const info = R.sourcesInfo(cards);
  for (const c of five) assert.equal(info.landSources[c], 7);   // Tarn (4) + Evolving Wilds (3) em todas as cores
});


test('drawHand: respeita quantidades, sem reposição, e conta terrenos da mão', () => {
  const mk = (name, qty, isLand) => ({ name, qty, cls: { isLand }, card: { name } });
  const cards = [mk('Forest', 24, true), mk('Elves', 4, false), mk('Big', 32, false)];
  for (let n = 0; n < 500; n++) {
    const { hand, lands } = R.drawHand(cards, 7);
    assert.equal(hand.length, 7);
    assert.equal(lands, hand.filter(c => c.name === 'Forest').length);
    assert.ok(hand.filter(c => c.name === 'Elves').length <= 4);
  }
  // deck pequeno: não passa do tamanho do deck e usa todas as cartas
  const tiny = R.drawHand([mk('A', 1, true), mk('B', 2, false)], 7);
  assert.equal(tiny.hand.length, 3); assert.equal(tiny.lands, 1);
  // determinístico com rng injetado
  const seq = [0.0, 0.0, 0.0]; let i = 0;
  const det = R.drawHand([mk('A', 1, true), mk('B', 1, false), mk('C', 1, false)], 2, () => seq[i++ % 3]);
  assert.deepEqual(det.hand.map(c => c.name), ['A', 'B']);
  // média de terrenos em 7 cartas de um deck 24/60 ≈ 2,8
  let sum = 0; const N = 4000;
  for (let n = 0; n < N; n++) sum += R.drawHand(cards, 7).lands;
  assert.ok(Math.abs(sum / N - 7 * 24 / 60) < 0.12, `média ${sum / N}`);
});


test('handLandOdds: distribuição hipergeométrica exata (soma 1, média n·K/N, valores conhecidos)', () => {
  const o = R.handLandOdds(60, 24, 7);
  assert.equal(o.length, 8);
  near(o.reduce((a, b) => a + b, 0), 1, 1e-12);
  near(o.reduce((a, p, k) => a + k * p, 0), 7 * 24 / 60, 1e-12);
  // P(0 terrenos) = C(36,7)/C(60,7) = 8347680 / 386206920
  near(o[0], 8347680 / 386206920, 1e-12);
  // P(2..4) bem conhecido para 24/60: ~0,77
  const keep = o[2] + o[3] + o[4]; assert.ok(keep > 0.74 && keep < 0.80, String(keep));
  // casos limite
  assert.deepEqual(R.handLandOdds(60, 0, 7).map(x => +x.toFixed(6)), [1, 0, 0, 0, 0, 0, 0, 0]);
  near(R.handLandOdds(60, 60, 7)[7], 1, 1e-12);
  assert.equal(R.handLandOdds(5, 2, 7).length, 6);   // mão limitada ao tamanho do deck
  // Commander: 100 cartas, 38 terrenos
  near(R.handLandOdds(100, 38, 7).reduce((a, b) => a + b, 0), 1, 1e-12);
});


test('lista só com nomes (sem quantidade): cada linha vale 1 cópia, repetidas somam, seções respeitadas', () => {
  const p = R.parseDeck('Lightning Bolt\nGoblin Guide\nMountain\nMountain\nMountain\n\nSideboard\nSmash to Smithereens\nSmash to Smithereens');
  assert.deepEqual([...p.main.entries()], [['Lightning Bolt', 1], ['Goblin Guide', 1], ['Mountain', 3]]);
  assert.deepEqual([...p.side.entries()], [['Smash to Smithereens', 2]]);
  // com "Deck" e categorias do Archidekt sem quantidade
  const q = R.parseDeck('Deck\nSol Ring [Ramp]\nCommand Tower\nBrainstorm [Maybeboard{noDeck}]');
  assert.deepEqual([...q.main.keys()], ['Sol Ring', 'Command Tower']); assert.equal(q.ignored, 1);
  // frases soltas e textos muito curtos não viram cartas
  assert.equal(R.parseDeck('Olá, quero montar um deck de fogo.').main.size, 0);
  assert.equal(R.parseDeck('Isso é uma frase longa. Outra frase aqui!\nMais uma pergunta?\nE outra coisa.').main.size, 0);
  // listas com quantidade continuam iguais
  assert.equal(R.parseDeck('4 Opt\n20 Island').main.get('Opt'), 4);
});


// ---------------------------------------------------------------------------------------------------
// free spells, cheats, comandante e propriedades matemáticas
const mkCard = o => ({ name: 'X', cmc: 2, type_line: 'Instant', oracle_text: '', layout: 'normal', rarity: 'common', mana_cost: '', keywords: [], ...o });
const entry = (qty, o, extra) => { const card = mkCard(o); return { name: card.name, qty, cls: R.classifyCard(card), card, ...extra }; };

test('free spells: custo alternativo (Force of Will, Fireblast, Daze, Snuff Out, Solitude) e não-free (Delve, Convoke)', () => {
  const fow = mkCard({ name: 'Force of Will', cmc: 5, mana_cost: '{3}{U}{U}', oracle_text: "You may pay 1 life and exile a blue card from your hand rather than pay this spell's mana cost." });
  const fireblast = mkCard({ name: 'Fireblast', cmc: 6, mana_cost: '{4}{R}{R}', oracle_text: "You may sacrifice two Mountains rather than pay this spell's mana cost." });
  const daze = mkCard({ name: 'Daze', cmc: 3, mana_cost: '{1}{U}', oracle_text: "You may return an Island you control to its owner's hand rather than pay this spell's mana cost." });
  const snuff = mkCard({ name: 'Snuff Out', cmc: 4, mana_cost: '{3}{B}', oracle_text: "If you control a Swamp, you may pay 4 life rather than pay this spell's mana cost." });
  const solitude = mkCard({ name: 'Solitude', type_line: 'Creature — Elemental Incarnation', cmc: 5, mana_cost: '{3}{W}{W}', keywords: ['Flash', 'Lifelink', 'Evoke'], oracle_text: 'Evoke—Exile a white card from your hand.' });
  const delve = mkCard({ name: 'Treasure Cruise', cmc: 8, mana_cost: '{7}{U}', keywords: ['Delve'], oracle_text: 'Delve\nDraw three cards.' });
  const convoke = mkCard({ name: 'Chord of Calling', cmc: 3, mana_cost: '{X}{G}{G}{G}', keywords: ['Convoke'], oracle_text: 'Convoke' });
  for (const c of [fow, fireblast, daze, snuff, solitude]) assert.equal(R.isFreeSpell(c), true, c.name);
  for (const c of [delve, convoke]) assert.equal(R.isFreeSpell(c), false, c.name);
});

test('cheats: Show and Tell, Braids, Sneak Attack, Kaalia, Eureka são detectados; Cultivate e Brainstorm não', () => {
  const sat = mkCard({ name: 'Show and Tell', cmc: 3, oracle_text: 'Each player may put an artifact, creature, enchantment, or land card from their hand onto the battlefield.' });
  const braids = mkCard({ name: 'Braids, Conjurer Adept', type_line: 'Legendary Creature — Human Wizard', cmc: 4, oracle_text: 'At the beginning of each player\'s upkeep, that player may put an artifact, creature, enchantment, or land card from their hand onto the battlefield.' });
  const sneak = mkCard({ name: 'Sneak Attack', type_line: 'Enchantment', cmc: 4, oracle_text: '{R}: You may put a creature card from your hand onto the battlefield. That creature gains haste.' });
  const kaalia = mkCard({ name: 'Kaalia of the Vast', type_line: 'Legendary Creature — Human Cleric', cmc: 4, oracle_text: 'Whenever Kaalia of the Vast attacks an opponent, you may put an Angel, Demon, or Dragon creature card from your hand onto the battlefield tapped and attacking that player.' });
  const eureka = mkCard({ name: 'Eureka', type_line: 'Sorcery', cmc: 4, oracle_text: 'Starting with you, each player may put a permanent card from their hand onto the battlefield. Repeat this process until no one puts a card onto the battlefield.' });
  assert.deepEqual([...R.cheatTypes(sat)].sort(), ['artifact', 'creature', 'enchantment']);   // terreno não conta (não custa mana)
  assert.deepEqual([...R.cheatTypes(braids)].sort(), ['artifact', 'creature', 'enchantment']);
  assert.deepEqual([...R.cheatTypes(sneak)], ['creature']);
  assert.deepEqual([...R.cheatTypes(kaalia)], ['creature']);
  assert.equal(R.cheatTypes(eureka).has('creature') && R.cheatTypes(eureka).has('artifact'), true);
  assert.equal(R.cheatTypes(mkCard({ name: 'Cultivate', type_line: 'Sorcery', oracle_text: 'Search your library for up to two basic land cards, put one onto the battlefield tapped and the other into your hand, then shuffle.' })), null);
  assert.equal(R.cheatTypes(mkCard({ name: 'Brainstorm', oracle_text: 'Draw three cards, then put two cards from your hand on top of your library in any order.' })), null);
});

test('cheat no comandante (Braids custa 4): cartas de custo 5+ dos tipos liberados saem de graça; 4 ou menos, não', () => {
  const braids = entry(1, { name: 'Braids, Conjurer Adept', type_line: 'Legendary Creature — Human Wizard', cmc: 4, mana_cost: '{2}{W}{U}', oracle_text: "At the beginning of each player's upkeep, that player may put an artifact, creature, enchantment, or land card from their hand onto the battlefield." }, { commander: true });
  const big = entry(1, { name: 'Sun Titan', type_line: 'Creature — Giant', cmc: 6, mana_cost: '{4}{W}{W}' });
  const five = entry(1, { name: 'Baneslayer Angel', type_line: 'Creature — Angel', cmc: 5, mana_cost: '{3}{W}{W}' });
  const four = entry(1, { name: 'Restoration Angel', type_line: 'Creature — Angel', cmc: 4, mana_cost: '{3}{W}' });
  const wrath = entry(1, { name: 'Wrath of God', type_line: 'Sorcery', cmc: 4, mana_cost: '{2}{W}{W}' });
  const bigSorcery = entry(1, { name: 'Terminus', type_line: 'Sorcery', cmc: 6, mana_cost: '{4}{W}{W}' });   // feitiço não é liberado pelo Braids
  const f = R.freeSpellInfo([braids, big, five, four, wrath, bigSorcery]);
  assert.deepEqual([...f.names].sort(), ['Baneslayer Angel', 'Sun Titan']);
  assert.equal(f.enablers.length, 1);
  // override do usuário: desmarcar uma carta a devolve à conta; marcar outra a tira
  const g = R.freeSpellInfo([braids, big, five, four], new Map([['Sun Titan', false], ['Restoration Angel', true]]));
  assert.deepEqual([...g.names].sort(), ['Baneslayer Angel', 'Restoration Angel']);
  // sem cheat no deck, nada de 5+ é free
  assert.equal(R.freeSpellInfo([big, five, four]).names.size, 0);
});

test('cheat barato (Show and Tell custa 3): só 5+ criaturas/artefatos/encantamentos; Omniscience entra, Counterspell não', () => {
  const sat = entry(4, { name: 'Show and Tell', cmc: 3, mana_cost: '{2}{U}', oracle_text: 'Each player may put an artifact, creature, enchantment, or land card from their hand onto the battlefield.' });
  const omni = entry(1, { name: 'Omniscience', type_line: 'Enchantment', cmc: 10, mana_cost: '{7}{U}{U}{U}' });
  const grise = entry(1, { name: 'Griselbrand', type_line: 'Legendary Creature — Demon', cmc: 8, mana_cost: '{4}{B}{B}{B}{B}' });
  const counter = entry(4, { name: 'Counterspell', cmc: 2, mana_cost: '{U}{U}' });
  const four = entry(1, { name: 'Four Drop', type_line: 'Creature — Beast', cmc: 4, mana_cost: '{3}{U}' });
  const info = R.sourcesInfo([sat, omni, grise, counter, four]);
  assert.deepEqual([...info.free.names].sort(), ['Griselbrand', 'Omniscience']);
  near(info.pips.U, 4 + 8 + 1);   // Show and Tell 4x1 + Counterspell 4x2 + Four Drop 1; Omniscience e Griselbrand ficam de fora
  assert.equal(info.pips.B, 0);
  assert.equal(info.maxSingle.U, 2);
});

test('propriedade: acrescentar free spells nunca muda pips, maxSingle nem fontes necessárias', () => {
  const body = [entry(4, { name: 'Counterspell', cmc: 2, mana_cost: '{U}{U}' }), entry(4, { name: 'Lightning Bolt', cmc: 1, mana_cost: '{R}' }), entry(4, { name: 'Brainstorm', cmc: 1, mana_cost: '{U}' })];
  const frees = [
    entry(4, { name: 'Force of Will', cmc: 5, mana_cost: '{3}{U}{U}', oracle_text: "You may pay 1 life and exile a blue card from your hand rather than pay this spell's mana cost." }),
    entry(4, { name: 'Fireblast', cmc: 6, mana_cost: '{4}{R}{R}', oracle_text: "You may sacrifice two Mountains rather than pay this spell's mana cost." }),
  ];
  const a = R.sourcesInfo(body), b = R.sourcesInfo([...body, ...frees]);
  assert.deepEqual(b.pips, a.pips); assert.deepEqual(b.maxSingle, a.maxSingle); assert.equal(b.totalPips, a.totalPips);
  assert.deepEqual(R.requiredSources(b, 24, 60).map(r => r.needed), R.requiredSources(a, 24, 60).map(r => r.needed));
});

test('propriedade: fontes entre 1 e o total de terrenos, soma das frações = 100%, mono-cor pede todos os terrenos', () => {
  let seed = 12345; const rnd = () => (seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296;
  for (let n = 0; n < 500; n++) {
    const lands = 14 + Math.floor(rnd() * 30), size = [40, 60, 100][Math.floor(rnd() * 3)];
    const pips = {}, maxSingle = {}, rampCredit = {}, landSources = {};
    let total = 0;
    for (const c of 'WUBRG') { const has = rnd() < 0.55; pips[c] = has ? 1 + Math.floor(rnd() * 30) : 0; maxSingle[c] = has ? 1 + Math.floor(rnd() * 5) : 0; rampCredit[c] = rnd() * 2; landSources[c] = 0; total += pips[c]; }
    if (!total) continue;
    const rows = R.requiredSources({ pips, totalPips: total, maxSingle, rampCredit, landSources }, lands, size);
    near(rows.reduce((a, r) => a + r.share, 0), 1, 1e-9);
    for (const r of rows) { assert.ok(r.needed >= 1 && r.needed <= lands, `needed ${r.needed} fora de 1..${lands}`); assert.ok(r.fromLands <= r.needed && r.fromLands >= 0); }
  }
  // mono-vermelho: 100% dos pips -> todos os terrenos são fonte de vermelho, nunca mais que isso
  for (const lands of [17, 20, 24, 40]) {
    const r = R.requiredSources({ pips: { W: 0, U: 0, B: 0, R: 44, G: 0 }, totalPips: 44, maxSingle: { W: 0, U: 0, B: 0, R: 4, G: 0 }, rampCredit: { W: 0, U: 0, B: 0, R: 0, G: 0 }, landSources: { W: 0, U: 0, B: 0, R: 0, G: 0 } }, lands, lands > 30 ? 100 : 60);
    assert.equal(r.length, 1); assert.equal(r[0].needed, lands);
  }
});

test('comandante: fica fora da biblioteca da mão (99 cartas) mas conta nas 100 do deck', () => {
  const cmd = entry(1, { name: 'Tatyova, Benthic Druid', type_line: 'Legendary Creature — Merfolk Druid', cmc: 4, mana_cost: '{3}{G}{U}' }, { commander: true });
  const forest = entry(40, { name: 'Forest', cmc: 0, type_line: 'Basic Land — Forest', produced_mana: ['G'] });
  const spells = entry(59, { name: 'Spell', cmc: 3, mana_cost: '{2}{G}' });
  const cards = [cmd, forest, spells];
  assert.equal(cards.reduce((a, c) => a + c.qty, 0), 100);
  for (let i = 0; i < 200; i++) {
    const { hand } = R.drawHand(cards, 7);
    assert.equal(hand.length, 7); assert.ok(hand.every(c => c.name !== 'Tatyova, Benthic Druid'));
  }
  // comandante também aparece na análise (CMC médio e pips), como carta do deck
  const agg = R.analyzeEntries([{ name: cmd.name, qty: 1, card: cmd.card, commander: true }, { name: 'Spell', qty: 3, card: spells.card }]);
  assert.equal(agg.cards[0].commander, true); near(agg.cmc, (4 + 9) / 4);
  // parser: seção "Commander" (Arena/Moxfield) e categoria do Archidekt
  const p = R.parseDeck('Commander\n1 Tatyova, Benthic Druid\n\nDeck\n1 Sol Ring\n30 Forest');
  assert.deepEqual([...p.commanders.keys()], ['Tatyova, Benthic Druid']); assert.equal(p.main.has('Sol Ring'), true); assert.equal(p.main.has('Tatyova, Benthic Druid'), false);
  const q = R.parseDeck('1 Tatyova, Benthic Druid\n\n1 Sol Ring\n1 Forest\n'.replace(/^/, 'Commander\n'));
  assert.deepEqual([...q.commanders.keys()], ['Tatyova, Benthic Druid']); assert.equal(q.main.size, 2);   // linha em branco encerra a seção do comandante
});

test('hipergeométrica: probabilidades somam 1 e a média bate com 7·L/N (biblioteca de 99 no Commander)', () => {
  for (const [N, L] of [[60, 24], [40, 17], [99, 37], [99, 0], [99, 99]]) {
    const o = R.handLandOdds(N, L, 7);
    near(o.reduce((a, b) => a + b, 0), 1, 1e-9);
    near(o.reduce((a, p, k) => a + k * p, 0), 7 * L / N, 1e-9);
  }
  near(R.handLandOdds(60, 24, 7)[0], (36 / 60) * (35 / 59) * (34 / 58) * (33 / 57) * (32 / 56) * (31 / 55) * (30 / 54), 1e-9);   // P(0 terrenos) à mão
});


test('free spells custam 0 na média de custo (CMC) e baixam os terrenos; sem free spell nada muda', () => {
  const body = [entry(4, { name: 'Lightning Bolt', cmc: 1, mana_cost: '{R}' }), entry(4, { name: 'Rift Bolt', cmc: 3, mana_cost: '{2}{R}' }), entry(20, { name: 'Mountain', cmc: 0, type_line: 'Basic Land — Mountain', produced_mana: ['R'] })];
  const fb = entry(4, { name: 'Fireblast', cmc: 6, mana_cost: '{4}{R}{R}', oracle_text: "You may sacrifice two Mountains rather than pay this spell's mana cost." });
  const sem = R.analyzeEntries(body);
  near(sem.cmc, (4 * 1 + 4 * 3) / 8);
  const com = R.analyzeEntries([...body, fb]);
  near(com.cmc, (4 * 1 + 4 * 3 + 4 * 0) / 12);       // Fireblast entra como custo 0, não 6
  assert.equal(com.freeCount, 4); assert.equal(com.spells, 12);
  const semFree = R.analyzeEntries([...body, entry(4, { name: 'Six Drop', cmc: 6, mana_cost: '{4}{R}{R}' })]);
  near(semFree.cmc, (4 + 12 + 24) / 12);               // sem ser free spell, o 6 conta normalmente
  // o usuário pode desfazer: Fireblast volta a custar 6
  near(R.analyzeEntries([...body, fb], { free: new Map([['Fireblast', false]]) }).cmc, (4 + 12 + 24) / 12);
  // menos CMC médio => menos terrenos no modelo
  const inp = c => ({ cmc: c, draw: 0, ramp: 0, companion: false, colors: 1, archetype: 'Aggro', size: 60 });
  assert.ok(R.predict(inp(com.cmc)).lands < R.predict(inp(semFree.cmc)).lands);
});
