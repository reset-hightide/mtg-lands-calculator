// Efeitos do playtest: a decisão é por texto de regras e por palavras do título (nunca por lista de cartas).
const test = require('node:test');
const assert = require('node:assert/strict');
const PtFx = require('../js/pt-effects.js');

const card = o => ({ name: 'X', type_line: 'Instant', oracle_text: '', colors: [], produced_mana: [], layout: 'normal', ...o });

test('analyze: varredor, dano, alvo, compra e busca de terreno, por texto', () => {
  assert.deepEqual(PtFx.analyze(card({ type_line: 'Sorcery', oracle_text: 'Destroy all creatures. They can\'t be regenerated.' })).wrath, { kinds: ['Creature'] });
  assert.deepEqual(PtFx.analyze(card({ type_line: 'Sorcery', oracle_text: 'Choose one —\n• Exile all artifacts.\n• Exile all creatures.' })).wrath.kinds, ['Artifact', 'Creature']);
  assert.equal(PtFx.analyze(card({ oracle_text: 'Lightning Bolt deals 3 damage to any target.' })).damage, 3);
  assert.equal(PtFx.analyze(card({ oracle_text: 'Counter target spell.' })).target, 'counter');
  assert.equal(PtFx.analyze(card({ oracle_text: 'Destroy target creature.' })).target, 'destroy');
  assert.equal(PtFx.analyze(card({ oracle_text: 'Return target creature to its owner\'s hand.' })).target, 'bounce');
  assert.equal(PtFx.analyze(card({ oracle_text: 'Draw three cards, then put two cards from your hand on top of your library in any order.' })).draw, 3);
  assert.equal(PtFx.analyze(card({ type_line: 'Creature — Merfolk', oracle_text: 'When this enters, draw two cards.' })).draw, 0);   // criatura que compra ao entrar não é "feitiço de compra"
  assert.deepEqual(PtFx.analyze(card({ type_line: 'Sorcery', oracle_text: 'Search your library for up to two basic land cards, reveal those cards, put one onto the battlefield tapped and the other into your hand, then shuffle.' })).ramp, { table: 1, hand: 1 });
  assert.deepEqual(PtFx.analyze(card({ type_line: 'Sorcery', oracle_text: 'Search your library for up to two basic land cards, put them onto the battlefield tapped, then shuffle.' })).ramp, { table: 2, hand: 0 });
});

test('analyze: custos alternativos de verdade (sacrificar, exilar da mão, devolver) e fetch/mana', () => {
  assert.deepEqual(PtFx.analyze(card({ oracle_text: "You may sacrifice two Mountains rather than pay this spell's mana cost." })).alt, { kind: 'sacrifice', type: 'Mountain', n: 2 });
  assert.deepEqual(PtFx.analyze(card({ oracle_text: "You may pay 1 life and exile a blue card from your hand rather than pay this spell's mana cost." })).alt, { kind: 'exile-hand', color: 'U', n: 1 });
  assert.deepEqual(PtFx.analyze(card({ oracle_text: "You may return an Island you control to its owner's hand rather than pay this spell's mana cost." })).alt, { kind: 'return', type: 'Island', n: 1 });
  const tarn = PtFx.analyze(card({ type_line: 'Land', oracle_text: '{T}, Pay 1 life, Sacrifice this land: Search your library for an Island or Mountain card, put it onto the battlefield, then shuffle.' }));
  assert.equal(tarn.fetch, true); assert.equal(tarn.land, true);
  assert.equal(PtFx.analyze(card({ type_line: 'Basic Land — Island', oracle_text: '({T}: Add {U}.)', produced_mana: ['U'] })).fetch, false);
  assert.equal(PtFx.analyze(card({ type_line: 'Creature — Elf', oracle_text: '{T}: Add {G}.', produced_mana: ['G'] })).tapMana, true);
  assert.equal(PtFx.analyze(card({ type_line: 'Creature — Goblin', oracle_text: 'Haste' })).haste, true);
});

test('hitByWrath: cada varredor só pega os tipos certos', () => {
  const land = PtFx.analyze(card({ type_line: 'Basic Land — Forest' })), crit = PtFx.analyze(card({ type_line: 'Creature — Elf' })), art = PtFx.analyze(card({ type_line: 'Artifact' }));
  assert.equal(PtFx.hitByWrath(['Creature'], crit), true); assert.equal(PtFx.hitByWrath(['Creature'], land), false);
  assert.equal(PtFx.hitByWrath(['!Land'], art), true); assert.equal(PtFx.hitByWrath(['!Land'], land), false);
  assert.equal(PtFx.hitByWrath(['*'], land), true); assert.equal(PtFx.hitByWrath(['Land'], land), true);
});

test('titleKeys: palavras do título viram zoeira (e cartas futuras entram sozinhas)', () => {
  const keys = n => PtFx.titleKeys(n).map(k => k.key);
  assert.deepEqual(keys('Lightning Bolt'), ['bolt']);
  assert.deepEqual(keys('Brainstorm'), ['storm', 'mind']);          // cérebro + tempestade
  assert.ok(keys('Tidal Wave').includes('water')); assert.ok(keys('Frost Titan').includes('ice'));
  assert.ok(keys('Wrath of God').includes('rage')); assert.ok(keys('Steam Vents').includes('steam')); assert.ok(keys('Command Tower').includes('castle'));
  assert.ok(keys('Swarm of Locusts').includes('zerg'));              // carta inventada: a regra pega pela palavra
  assert.equal(PtFx.titleKeys('Goblin Guide')[0].emoji, '👺'); assert.equal(PtFx.titleKeys('Dragon Whelp')[0].emoji, '🐉');
  assert.deepEqual(keys('Tarmogoyf'), []);                          // sem palavra reconhecida, sem efeito
  assert.ok(PtFx.titleKeys('Thunderstorm Frost Dragon Inferno').length <= 2);   // no máximo 2 efeitos por carta
});

test('landKey: terreno virado ganha um efeito discreto pelo nome', () => {
  assert.equal(PtFx.landKey('Island'), 'ripple'); assert.equal(PtFx.landKey('Mountain'), 'dust'); assert.equal(PtFx.landKey('Forest'), 'leaves');
  assert.equal(PtFx.landKey('Swamp'), 'bubbles'); assert.equal(PtFx.landKey('Plains'), 'sunray'); assert.equal(PtFx.landKey('Volcanic Island'), 'ember');
  assert.equal(PtFx.landKey('Command Tower'), null);
});
