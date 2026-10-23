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
