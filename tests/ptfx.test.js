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

test('castKeys: a variação vem do nome (hash estável) ou de uma palavra do título, dentro da piscina da cor', () => {
  const k = (n, c) => PtFx.castKeys(n, c);
  // estável: a mesma carta cai sempre na mesma variação
  assert.deepEqual(k('Doom Blade', ['B']), k('Doom Blade', ['B']));
  // sempre uma variação da piscina da cor
  for (const [c, pool] of Object.entries(PtFx.POOLS)) for (const n of ['Carta Um', 'Carta Dois', 'Outra Carta', 'Mais Uma']) assert.ok(pool.includes(k(n, c === 'C' ? [] : [c])[0]), n + ' ' + c);
  // palavra do título força a variação (mesmo numa carta de outra cor)
  assert.equal(k('Lightning Helix', ['W', 'R'])[0], 'bolt'); assert.equal(k('Tidal Wave', ['R'])[0], 'tide'); assert.equal(k('Vampire Nighthawk', ['B'])[0], 'bats');
  assert.equal(k('Spider Spawning', ['G'])[0], 'web'); assert.equal(k('Inkmoth Nexus', [])[0], 'ink'); assert.equal(k('Wild Growth', ['U'])[0], 'vines');
  assert.equal(k('Shield of the Realm', ['R'])[0], 'dome'); assert.equal(k('Angel of Serenity', ['W'])[0], 'feathers'); assert.equal(k('Toxic Deluge', ['B'])[0], 'tide');
  // extra global do título (gelo é variação azul; terremoto/disco/enxame são extras)
  assert.deepEqual(k('Frost Titan', ['U']), ['frost', 'earth']);
  assert.ok(k('Swarm of Locusts', ['G']).includes('zerg')); assert.ok(k('Wrath of God', ['W']).includes('rage')); assert.ok(k('Time Walk', ['U']).includes('time'));
});

test('variedade: cartas pretas NÃO caem todas no mesmo efeito (nem em buraco negro)', () => {
  const nomes = Array.from({ length: 300 }, (_, i) => 'Carta Preta ' + i * 7 + ' de ' + 'ABCDEFGHIJ'[i % 10]);
  for (const cor of ['B', 'R', 'W', 'U', 'G']) {
    const cont = {}; nomes.forEach(n => { const v = PtFx.castKeys(n, [cor])[0]; cont[v] = (cont[v] || 0) + 1; });
    const pool = PtFx.POOLS[cor];
    assert.equal(Object.keys(cont).length, pool.length, cor + ' usa a piscina inteira: ' + JSON.stringify(cont));
    assert.ok(Math.max(...Object.values(cont)) < nomes.length * 0.35, cor + ' sem variação dominante: ' + JSON.stringify(cont));
  }
  assert.ok(PtFx.POOLS.B.length >= 6 && PtFx.POOLS.R.length >= 6 && PtFx.POOLS.G.length >= 5);
});

test('titleKeys: regra por palavra (e nada para título sem palavra reconhecida)', () => {
  const keys = n => PtFx.titleKeys(n).map(k => k.key);
  assert.ok(keys('Brainstorm').includes('rain'));                 // brain + storm: a tempestade
  assert.ok(keys('Wrath of God').includes('divine') && keys('Wrath of God').includes('rage'));
  assert.ok(keys('Steam Vents').includes('steam')); assert.ok(keys('Time Walk').includes('time'));
  assert.ok(keys('Dragon Whelp').includes('breath')); assert.ok(keys('Magma Jet').includes('lava')); assert.ok(keys('Vampire Lacerator').includes('bats'));
  assert.deepEqual(keys('Tarmogoyf'), []);
  assert.ok(PtFx.titleKeys('Thunderstorm Frost Dragon Inferno').length <= 3);
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

test('nível do efeito pelo custo de mana: barata = sutil, cara = a tela toda', () => {
  assert.deepEqual([0, 1, 2].map(PtFx.level), [1, 1, 1]); assert.deepEqual([3, 4].map(PtFx.level), [2, 2]); assert.deepEqual([5, 6, 10].map(PtFx.level), [3, 3, 3]);
});

test('tipo de criatura e texto de regras escolhem o efeito (sem lista de nomes)', () => {
  assert.ok(PtFx.typeKeys('Legendary Creature — Vampire Knight').includes('blooddrops'));
  assert.ok(PtFx.typeKeys('Creature — Elf Archer').includes('arrows'));
  assert.ok(PtFx.typeKeys('Creature — Merfolk Wizard').includes('fish') && PtFx.typeKeys('Creature — Merfolk Wizard').includes('runes'));
  assert.deepEqual(PtFx.typeKeys('Creature — Human'), []);
  assert.ok(PtFx.oracleKeys('Counter target spell.').includes('nullring'));
  assert.ok(PtFx.oracleKeys('Draw two cards.').includes('pages'));
  assert.ok(PtFx.oracleKeys('You gain 4 life.').includes('heal'));
  // a assinatura vem do tipo/regras quando o título não tem palavra reconhecida, e é estável
  const k = PtFx.castKeys('Fulano Sem Pista', ['G'], 'Creature — Elf Scout', '');
  assert.equal(k[0], 'arrows'); assert.deepEqual(k, PtFx.castKeys('Fulano Sem Pista', ['G'], 'Creature — Elf Scout', ''));
  assert.equal(PtFx.castKeys('Fulano Sem Pista', ['U'], 'Instant', 'Counter target spell.')[0], 'nullring');
  // palavra do título ainda manda
  assert.equal(PtFx.castKeys('Lightning Elf', ['G'], 'Creature — Elf', '')[0], 'bolt');
  // variedade: vários tipos e textos geram vários efeitos
  const tipos = ['Creature — Wolf', 'Creature — Zombie', 'Creature — Bird', 'Creature — Snake', 'Creature — Goblin', 'Creature — Spirit', 'Creature — Pirate'];
  assert.equal(new Set(tipos.map(t => PtFx.castKeys('X', [], t, '')[0])).size, tipos.length);
});

test('franquias: pela edição (e pelo baralho), com piscina própria', () => {
  assert.equal(PtFx.franchiseOf('LTR'), 'lotr'); assert.equal(PtFx.franchiseOf('ltc'), 'lotr'); assert.equal(PtFx.franchiseOf('dom'), null);
  assert.equal(PtFx.deckFranchise(['ltr', 'ltr', 'dom', 'dom', 'dom']), 'lotr'); assert.equal(PtFx.deckFranchise(['ltr', 'dom', 'dom', 'dom', 'dom', 'dom']), null);
  for (const n of ['Aragorn', 'Frodo', 'Sam', 'Gollum', 'Boromir', 'Pippin']) assert.ok(PtFx.FRANCHISE_KEYS.lotr.includes(PtFx.castKeys(n + ' zzz', ['W'], 'Creature — Human', '', 'lotr')[0]), n);
  assert.equal(new Set(Array.from({ length: 60 }, (_, i) => PtFx.castKeys('Carta ' + i, ['G'], 'Creature — Human', '', 'lotr')[0])).size, PtFx.FRANCHISE_KEYS.lotr.length);
});

test('anéis: mana rock de 2+ manas = anel de fogo; The Ring tempts you = Anel Único (acima do título e da franquia)', () => {
  assert.ok(PtFx.oracleKeys('{T}: Add {C}{C}.').includes('firering'));
  assert.ok(!PtFx.oracleKeys('{T}: Add {C}.').includes('firering'));
  assert.ok(PtFx.oracleKeys('At the beginning of your upkeep, you lose 1 life for each burden counter on it.').includes('onering'));
  assert.equal(PtFx.castKeys('Anel Qualquer', [], 'Artifact', '{T}: Add {C}{C}.')[0], 'firering');
  assert.equal(PtFx.castKeys('Sol Ring', [], 'Artifact', '{T}: Add {C}{C}.')[0], 'firering');          // "Ring" no título (halo) perde para a regra
  assert.equal(PtFx.castKeys('The One Ring', [], 'Legendary Artifact', 'Indestructible\nAt the beginning of your upkeep, you lose 1 life for each burden counter.', 'lotr')[0], 'onering');
});
