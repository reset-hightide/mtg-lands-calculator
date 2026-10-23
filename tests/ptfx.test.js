// Efeitos do playtest: a decisão é por texto de regras, por cor e por palavras do título (nunca por lista de cartas).
const test = require('node:test');
const assert = require('node:assert/strict');
const PtFx = require('../js/pt-effects.js');

const card = o => ({ name: 'X', type_line: 'Instant', oracle_text: '', colors: [], produced_mana: [], layout: 'normal', ...o });

test('analyze: destruição global por texto (varredor, modos, tipos)', () => {
  assert.deepEqual(PtFx.analyze(card({ type_line: 'Sorcery', oracle_text: 'Destroy all creatures. They can\'t be regenerated.' })).wrath, { kinds: ['Creature'] });
  assert.deepEqual(PtFx.analyze(card({ type_line: 'Sorcery', oracle_text: 'Choose one —\n• Exile all artifacts.\n• Exile all creatures.' })).wrath.kinds, ['Artifact', 'Creature']);
  assert.deepEqual(PtFx.analyze(card({ type_line: 'Sorcery', oracle_text: 'Destroy all lands.' })).wrath, { kinds: ['Land'] });
  assert.equal(PtFx.analyze(card({ oracle_text: 'Destroy target creature.' })).wrath, null);   // alvo único não é destruição global
});

test('analyze: fetch land e quais terrenos ela busca', () => {
  const tarn = PtFx.analyze(card({ type_line: 'Land', oracle_text: '{T}, Pay 1 life, Sacrifice this land: Search your library for an Island or Mountain card, put it onto the battlefield, then shuffle.' }));
  assert.equal(tarn.fetch, true); assert.deepEqual(tarn.fetchTypes, ['Island', 'Mountain']);
  const wilds = PtFx.analyze(card({ type_line: 'Land', oracle_text: '{T}, Sacrifice this land: Search your library for a basic land card, put it onto the battlefield tapped, then shuffle.' }));
  assert.equal(wilds.fetch, true); assert.deepEqual(wilds.fetchTypes.sort(), ['Forest', 'Island', 'Mountain', 'Plains', 'Swamp']);
  const three = PtFx.analyze(card({ type_line: 'Land', oracle_text: '{T}, Pay 1 life, Sacrifice this land: Search your library for a Mountain, Forest, or Plains card, put it onto the battlefield, then shuffle.' }));
  assert.deepEqual(three.fetchTypes.sort(), ['Forest', 'Mountain', 'Plains']);
  assert.equal(PtFx.analyze(card({ type_line: 'Basic Land — Island', oracle_text: '({T}: Add {U}.)', produced_mana: ['U'] })).fetch, false);
});

test('landScore: duais com tipo básico da melhor para a pior; básicos por último', () => {
  const s = (t, o) => PtFx.landScore(t, o);
  const original = s('Land — Island Mountain', '({T}: Add {U} or {R}.)');
  const shock = s('Land — Island Mountain', '({T}: Add {U} or {R}.)\nAs this land enters, you may pay 2 life. If you don\'t, it enters tapped.');
  const triome = s('Land — Island Mountain Forest', '({T}: Add {U}, {R}, or {G}.)\nThis land enters tapped.\nCycling {3}');
  const tapland = s('Land — Island Mountain', '({T}: Add {U} or {R}.)\nThis land enters tapped.');
  const basic = s('Basic Land — Island', '({T}: Add {U}.)');
  assert.ok(original > shock && shock > triome && triome > basic, [original, shock, triome, basic].join(' '));
  assert.ok(tapland <= triome + 5 && tapland > basic);
  assert.equal(PtFx.colorOfType('Island'), 'U'); assert.equal(PtFx.colorOfType('Mountain'), 'R');
});

test('castKeys: a cor dá a assinatura; palavras do título trocam ou acrescentam (sem emoji)', () => {
  const k = (n, c, r) => PtFx.castKeys(n, c, () => r || 0);
  assert.deepEqual(k('Qualquer Coisa', ['R']), ['bolt']); assert.deepEqual(k('Qualquer Coisa', ['W']), ['divine']);
  assert.deepEqual(k('Qualquer Coisa', ['U']), ['tide']); assert.deepEqual(k('Qualquer Coisa', ['B']), ['void']);
  assert.deepEqual(k('Qualquer Coisa', ['G']), ['vines']); assert.deepEqual(k('Qualquer Coisa', []), ['metal']);
  assert.deepEqual(k('Qualquer Coisa', ['U', 'R'], 0.99), ['bolt']);                       // multicor: sorteia entre as cores
  assert.deepEqual(k('Lightning Helix', ['W', 'R']), ['bolt']);                              // título manda: Lightning = raio
  assert.deepEqual(k('Tidal Wave', ['R']), ['tide']); assert.deepEqual(k('Frost Titan', ['U']), ['tide', 'ice']);
  assert.deepEqual(k('Wild Growth', ['U']), ['vines']);                                     // verde pelo título, mesmo numa carta azul
  assert.ok(k('Swarm of Locusts', ['G']).includes('zerg'));                                 // carta que ainda vai sair: a regra pega pela palavra
  const all = PtFx.titleKeys('Thunderstorm Frost Dragon Inferno'); assert.ok(all.length <= 2);
  for (const key of ['bolt', 'fire', 'tide', 'divine', 'void', 'vines', 'metal']) assert.ok(typeof key === 'string');
});

test('titleKeys: regra por palavra (e nada para título sem palavra reconhecida)', () => {
  const keys = n => PtFx.titleKeys(n).map(k => k.key);
  assert.deepEqual(keys('Brainstorm'), ['storm']);               // brain + storm: a tempestade
  assert.ok(keys('Wrath of God').includes('divine') && keys('Wrath of God').includes('rage'));
  assert.ok(keys('Steam Vents').includes('steam')); assert.ok(keys('Time Walk').includes('time'));
  assert.deepEqual(keys('Tarmogoyf'), []);
});

test('landKey: terreno virado ganha um efeito discreto pelo nome', () => {
  assert.equal(PtFx.landKey('Island'), 'ripple'); assert.equal(PtFx.landKey('Mountain'), 'dust'); assert.equal(PtFx.landKey('Forest'), 'leaves');
  assert.equal(PtFx.landKey('Swamp'), 'bubbles'); assert.equal(PtFx.landKey('Plains'), 'sunray'); assert.equal(PtFx.landKey('Volcanic Island'), 'ember');
  assert.equal(PtFx.landKey('Command Tower'), null);
});

test('hitByWrath: cada varredor só pega os tipos certos', () => {
  const land = PtFx.analyze(card({ type_line: 'Basic Land — Forest' })), crit = PtFx.analyze(card({ type_line: 'Creature — Elf' })), art = PtFx.analyze(card({ type_line: 'Artifact' }));
  assert.equal(PtFx.hitByWrath(['Creature'], crit), true); assert.equal(PtFx.hitByWrath(['Creature'], land), false);
  assert.equal(PtFx.hitByWrath(['!Land'], art), true); assert.equal(PtFx.hitByWrath(['!Land'], land), false);
  assert.equal(PtFx.hitByWrath(['*'], land), true); assert.equal(PtFx.hitByWrath(['Land'], land), true);
});
