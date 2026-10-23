const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const X = require('../js/xlsx-lite.js');
const R = require('../js/rules.js');
const P = require('../js/pipeline.js');
const T = require('../js/template.js');

const near = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} != ${b}`);
const toAB = u8 => u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength);

// ---------------------------------------------------------------- xlsx
test('xlsx: escrita -> leitura preserva texto, acentos, símbolos XML, números e linhas vazias', async () => {
  const bytes = X.writeXlsx([
    { name: 'Dados', header: true, rows: [['Deck', 'Qtd', 'Carta'], ['Açaí & <Cia> "x"', 4, "Uro, Titan of Nature's Wrath"], [], ['', 2.5, 'Fire // Ice']] },
    { name: 'Outra', rows: [[{ v: 'título', s: 3 }], [true, false]] },
  ]);
  const wb = await X.readXlsx(toAB(bytes));
  assert.deepEqual(Object.keys(wb), ['Dados', 'Outra']);
  assert.deepEqual(wb.Dados[0], ['Deck', 'Qtd', 'Carta']);
  assert.deepEqual(wb.Dados[1], ['Açaí & <Cia> "x"', 4, "Uro, Titan of Nature's Wrath"]);
  assert.deepEqual(wb.Dados[2], []);
  assert.deepEqual(wb.Dados[3], ['', 2.5, 'Fire // Ice']);
  assert.deepEqual(wb.Outra[1], [true, false]);
});

test('xlsx: CRC32 correto (vetor conhecido) e arquivo é um ZIP íntegro', () => {
  assert.equal(X._crc32(new TextEncoder().encode('123456789')), 0xcbf43926);
  const bytes = X.writeXlsx([{ name: 'A', rows: [['x']] }]);
  assert.equal(bytes[0], 0x50); assert.equal(bytes[1], 0x4b);
});

test('xlsx: lê arquivos reais salvos por outros programas (se TCC_DIR estiver definido)', async (t) => {
  const dir = process.env.TCC_DIR;
  if (!dir) return t.skip('defina TCC_DIR com a pasta do TCC para este teste');
  let read = 0;
  for (const f of ['tabelas.xlsx', 'estatisticas_descritivas_base.xlsx', 'diagnostico_pressupostos_modelo_irrestrito.xlsx']) {
    const p = path.join(dir, f); if (!fs.existsSync(p)) continue;
    const wb = await X.readXlsx(toAB(fs.readFileSync(p)));
    const rows = Object.values(wb)[0];
    assert.ok(rows.length > 1 && rows.some(r => r.some(c => c !== '')), f);
    read++;
  }
  assert.ok(read > 0);
});

test('csv: vírgula, ponto e vírgula, aspas e quebra de linha', () => {
  assert.deepEqual(X.parseCsv('a,b\n1,"x,y"\n'), [['a', 'b'], ['1', 'x,y']]);
  assert.deepEqual(X.parseCsv('Deck;Qtd\r\nA;4\r\n'), [['Deck', 'Qtd'], ['A', '4']]);
  assert.deepEqual(X.parseCsv('﻿a\n"he said ""hi"""'), [['a'], ['he said "hi"']]);
});

// ---------------------------------------------------------------- template
test('template: gera e relê com as 3 abas esperadas e o exemplo parseável', async () => {
  const wb = await X.readXlsx(toAB(T.buildTemplate()));
  assert.deepEqual(Object.keys(wb), ['Instruções', 'Decks', 'Cartas']);
  assert.deepEqual(wb.Decks[0], ['Deck', 'Arquétipo', 'Tamanho', 'Companion', 'Cores']);
  const { decks, warnings } = P.decksFromSheets(wb);
  assert.equal(decks.length, 1); assert.deepEqual(warnings, []);
  assert.equal(decks[0].main.get('Llanowar Elves'), 4);
  assert.equal(decks[0].side.get('Lurrus of the Dream-Den'), 1);
  assert.equal(decks[0].params.archetype, 'Auto');
});

// ---------------------------------------------------------------- planilha -> decks
const sheets = rows => ({ Cartas: rows });

test('pipeline: preenchimento do nome do deck para baixo, seções e quantidades "4x"', () => {
  const { decks } = P.decksFromSheets(sheets([
    ['Deck', 'Quantidade', 'Carta', 'Seção'],
    ['A', 4, 'Opt', 'Main'], ['', '2x', 'Island', ''], ['', 1, 'Negate', 'Side'],
    ['B', 3, 'Shock', 'main'], ['', 1, 'Lurrus of the Dream-Den', 'Companion'],
  ]));
  assert.equal(decks.length, 2);
  assert.equal(decks[0].main.get('Island'), 2); assert.equal(decks[0].side.get('Negate'), 1);
  assert.equal(decks[1].companionSection, true);
});

test('pipeline: cabeçalhos alternativos, "4 Nome" numa coluna só, linhas inválidas viram aviso', () => {
  const { decks } = P.decksFromSheets({ Planilha1: [['card'], ['4 Lightning Bolt (M10) 146'], ['Mountain']] });
  assert.equal(decks[0].main.get('Lightning Bolt'), 4);
  assert.equal(decks[0].main.get('Mountain'), 1);
  assert.throws(() => P.decksFromSheets({ Cartas: [['foo', 'bar'], [1, 2]] }), /coluna chamada "Carta"/);
  assert.throws(() => P.decksFromSheets({ Cartas: [['Carta']] }), /Nenhuma carta/);
  const w = P.decksFromSheets(sheets([['Quantidade', 'Carta'], [-2, 'Opt'], [1.5, 'Opt'], [999, 'Opt'], [4, 'Opt']])).warnings;
  assert.equal(w.length, 3);
});

test('pipeline: parâmetros da aba Decks (dropdowns) chegam ao deck', () => {
  const { decks } = P.decksFromSheets({
    Decks: [['Deck', 'Arquétipo', 'Tamanho', 'Companion', 'Cores'], ['X', 'Control', 60, 'Sim', 'UB']],
    Cartas: [['Deck', 'Quantidade', 'Carta'], ['X', 4, 'Opt']],
  });
  assert.deepEqual(decks[0].params, { archetype: 'Control', size: 60, companion: 'Sim', colors: 'UB' });
});

// ---------------------------------------------------------------- avaliação
const card = o => ({ name: 'X', cmc: 1, type_line: 'Instant', oracle_text: '', layout: 'normal', rarity: 'common', colors: [], keywords: [], ...o });
const DB = {
  Island: card({ name: 'Island', type_line: 'Basic Land — Island', cmc: 0, color_identity: ['U'] }),
  Forest: card({ name: 'Forest', type_line: 'Basic Land — Forest', cmc: 0, color_identity: ['G'] }),
  'Llanowar Elves': card({ name: 'Llanowar Elves', type_line: 'Creature — Elf Druid', oracle_text: '{T}: Add {G}.', colors: ['G'] }),
  Opt: card({ name: 'Opt', oracle_text: 'Scry 1. Draw a card.', colors: ['U'] }),
  Big: card({ name: 'Big', cmc: 5, type_line: 'Creature', colors: ['G'] }),
  'Lurrus of the Dream-Den': card({ name: 'Lurrus of the Dream-Den', type_line: 'Legendary Creature', cmc: 3, keywords: ['Companion', 'Lifelink'] }),
  Negate: card({ name: 'Negate', cmc: 2, colors: ['U'] }),
};
const get = n => DB[n];

function deck(main, side = [], params = {}, name = 'Meu deck') {
  return { name, params, main: new Map(main), side: new Map(side), companionSection: false };
}

test('evaluateDeck: números batem com a fórmula feita à mão', () => {
  // 24 Island + 4 Elves(1) + 4 Opt(1) + 28 Big(5): 60 cartas; CMC = (4+4+140)/36
  const d = deck([['Island', 24], ['Llanowar Elves', 4], ['Opt', 4], ['Big', 28]], [['Negate', 2]], { archetype: 'Midrange', colors: 'UG' });
  const r = P.evaluateDeck(d, get);
  assert.equal(r.ok, true);
  near(r.cmc, 148 / 36);
  assert.equal(r.draw, 4); assert.equal(r.ramp, 4); assert.equal(r.size, 60);
  const expected = 20.2185 + 1.4316 * (148 / 36) + 0.6391 * 2 - 0.2283 * 4 - 0.2304 * 4;
  near(r.lands, expected, 1e-9);
  near(r.currentLands, 24);
  near(r.delta, expected - 24, 1e-9);
  assert.equal(r.archetypeSource, 'informado'); assert.equal(r.colorsSource, 'informado');
});

test('evaluateDeck: automáticos (arquétipo, tamanho, companion, cores) e avisos', () => {
  const d = deck([['Island', 12], ['Forest', 12], ['Llanowar Elves', 4], ['Opt', 4], ['Big', 28]], [['Lurrus of the Dream-Den', 1], ['Negate', 1]], {}, 'Simic Ramp');
  const r = P.evaluateDeck(d, get);
  assert.equal(r.archetype, 'Ramp'); assert.match(r.archetypeSource, /sugerido/);
  assert.equal(r.size, 60); assert.equal(r.companion, true);
  assert.equal(r.colorsList, 'GU'); assert.equal(r.colorsSource, 'nome do deck');
  // sem cor no nome: usa terrenos básicos da lista
  const r2 = P.evaluateDeck(deck([['Island', 24], ['Opt', 36]], [], {}, 'Meu deck'), get);
  assert.equal(r2.colorsList, 'U'); assert.equal(r2.colorsSource, 'terrenos básicos');
  // sem básicos nem nome: cores das mágicas
  const r3 = P.evaluateDeck(deck([['Opt', 36], ['Big', 24]], [], {}, 'Sem pistas'), get);
  assert.equal(r3.colorsList, 'UG'); assert.equal(r3.colorsSource, 'cores das mágicas');
});

test('evaluateDeck: entradas inválidas geram avisos, não exceções', () => {
  const d = deck([['Island', 24], ['Opt', 30], ['Inexistente', 6]], [], { archetype: 'Foo', size: 55, colors: 'zzz', companion: 'talvez' });
  const r = P.evaluateDeck(d, get);
  assert.equal(r.ok, true);
  assert.ok(r.warnings.some(w => /Arquétipo “Foo”/.test(w)));
  assert.ok(r.warnings.some(w => /Cores “zzz”/.test(w)));
  assert.ok(r.warnings.some(w => /Inexistente/.test(w)));
  assert.equal(r.companion, false);
  assert.deepEqual(r.missing, ['Inexistente']);
  const none = P.evaluateDeck(deck([['Inexistente', 60]]), get);
  assert.equal(none.ok, false);
});

test('evaluateDeck: 40 e 100 cartas escalam como nas equações (17) e (20)', () => {
  const base = { archetype: 'Midrange', colors: 'U', companion: 'Não' };
  const mk = n => deck([['Island', n * 0.4], ['Big', n * 0.6]], [], { ...base, size: n });
  const r40 = P.evaluateDeck(mk(40), get), r100 = P.evaluateDeck(mk(100), get);
  const z = 0.6391 * 1;   // 1 cor, Midrange
  near(r40.lands, (40 / 60) * (20.2185 + 1.4316 * 5 + z), 1e-9);
  near(r100.lands, (100 / 60) * (20.2185 + 1.4316 * 5 + z), 1e-9);
});

test('buildResults: planilha de resultado relê corretamente', async () => {
  const d = deck([['Island', 24], ['Llanowar Elves', 4], ['Big', 32], ['Inexistente', 1]], [], { archetype: 'Aggro', colors: 'G' });
  const res = P.evaluateDeck(d, get);
  const wb = await X.readXlsx(toAB(T.buildResults([res, { name: 'Falhou', ok: false, error: 'x', warnings: [] }])));
  assert.deepEqual(Object.keys(wb), ['Resumo', 'Cartas']);
  assert.equal(wb.Resumo[0][0], 'Deck'); assert.equal(wb.Resumo[1][0], 'Meu deck');
  near(wb.Resumo[1][1], Math.round(res.lands * 100) / 100, 1e-9);
  assert.equal(wb.Resumo[1][12], 'Aggro'); assert.match(wb.Resumo[2][1], /erro/);
  assert.ok(wb.Cartas.some(r => r[3] === 'NÃO ENCONTRADA'));
});

test('evaluateDeck: "nenhuma" cor é respeitado (deck incolor) com aviso, sem cair no automático', () => {
  const r = P.evaluateDeck(deck([['Island', 24], ['Opt', 36]], [], { colors: 'nenhuma' }), get);
  assert.equal(r.inputs.colors, 0); assert.equal(r.colorsSource, 'informado');
  assert.ok(r.warnings.some(w => /Nenhuma cor/.test(w)));
});

test('evaluateDeck: cartas excluídas deixam de contar como compra/aceleração', () => {
  const d = deck([['Island', 24], ['Llanowar Elves', 4], ['Opt', 4], ['Big', 28]], [], { archetype: 'Midrange', colors: 'U' });
  const a = P.evaluateDeck(d, get);
  d.excluded = new Set(['Opt']);
  const b = P.evaluateDeck(d, get);
  assert.equal(a.draw, 4); assert.equal(b.draw, 0); assert.equal(b.ramp, 4);
  near(b.lands - a.lands, 0.2283 * 4, 1e-9);
  near(b.cmc, a.cmc, 1e-12);   // CMC não muda
});
