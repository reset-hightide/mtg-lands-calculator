// Cliente da API de decks de Commander (EDHREC): testado com respostas simuladas, sem rede.
const test = require('node:test');
const assert = require('node:assert/strict');
const DeckApi = require('../js/deckapi.js');
const R = require('../js/rules.js');

const top = { container: { json_dict: { cardlists: [{ cardviews: [
  { name: 'Atraxa, Praetors\' Voice', sanitized: 'atraxa-praetors-voice', num_decks: 100 }, { name: 'Tatyova, Benthic Druid', sanitized: 'tatyova-benthic-druid', num_decks: 80 } ] }] } } };
const lands = [['Forest', 12], ['Island', 12], ['Command Tower', 1]];
const spells = Array.from({ length: 60 }, (_, i) => ['Carta ' + i, 1]);
const avg = { deck: { commander: ['Tatyova, Benthic Druid'], commander_v2: [['Tatyova, Benthic Druid', 1]], cards: { Creature: spells.slice(0, 30), Sorcery: spells.slice(30), Land: lands } } };
const mockFetch = async url => ({ ok: true, status: 200, json: async () => (/commanders\//.test(url) ? top : avg) });

test('topCommanders lê a lista de populares', async () => {
  const list = await DeckApi.topCommanders('year', mockFetch);
  assert.equal(list.length, 2); assert.deepEqual(list[1], { name: 'Tatyova, Benthic Druid', slug: 'tatyova-benthic-druid', decks: 80 });
});

test('randomCommanderDeck devolve um deck no formato que o site lê (Commander + Deck) e o leitor de listas entende', async () => {
  const d = await DeckApi.randomCommanderDeck({ fetch: mockFetch, rnd: () => 0.99 });
  assert.equal(d.name, 'Tatyova, Benthic Druid'); assert.equal(d.source, 'EDHREC'); assert.match(d.url, /edhrec\.com\/average-decks\/tatyova/);
  const p = R.parseDeck(d.text);
  assert.deepEqual([...p.commanders.keys()], ['Tatyova, Benthic Druid']);
  assert.equal([...p.main.values()].reduce((a, b) => a + b, 0), 60 + 25);   // o comandante fica à parte
});

test('randomCommanderDeck: sem rede ou deck incompleto devolve null (o site usa o exemplo local)', async () => {
  assert.equal(await DeckApi.randomCommanderDeck({ fetch: async () => { throw new Error('sem rede'); } }), null);
  const tiny = async url => ({ ok: true, status: 200, json: async () => (/commanders\//.test(url) ? top : { deck: { commander_v2: [['X', 1]], cards: { Land: [['Forest', 3]] } } }) });
  assert.equal(await DeckApi.randomCommanderDeck({ fetch: tiny }), null);
  assert.equal(await DeckApi.randomCommanderDeck({ fetch: async () => ({ ok: false, status: 503, json: async () => ({}) }) }), null);
});
