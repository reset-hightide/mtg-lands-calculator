// Impressão preferida: a mais próxima da 7ª Edição (11/04/2001), sempre em inglês; nomes em português viram a carta em inglês.
const test = require('node:test');
const assert = require('node:assert/strict');
const Scryfall = require('../js/scryfall.js');

const img = { normal: 'https://img/x.jpg' };
const card = (name, set, released_at, extra = {}) => ({ name, set, released_at, lang: 'en', image_uris: img, cmc: 2, type_line: 'Instant', oracle_id: 'o-' + name, ...extra });
const json = body => ({ ok: true, status: 200, json: async () => body });

test('escolhe a impressão mais perto da 7ª Edição (antes ou depois) e traduz nome em português', async () => {
  const calls = [];
  const mock = async (url, opts = {}) => {
    calls.push(url);
    if (url.endsWith('/cards/collection')) {
      const ids = JSON.parse(opts.body).identifiers;
      return json({ data: ids.filter(i => i.oracle_id || i.name !== 'Contramagica').map(i => i.oracle_id ? card('Counterspell', 'new', '2024-01-01') : card(i.name, 'new', '2024-01-01')) });
    }
    const q = decodeURIComponent(url.split('q=')[1].split('&')[0]);
    if (q.includes('lang:pt')) return json({ data: [{ ...card('Counterspell', 'x', '2000-01-01'), lang: 'pt', printed_name: 'Contramágica', oracle_id: 'o-Counterspell' }] });
    if (q.includes('date>=2001-04-11')) return json({ data: [card('Opt', 'dom', '2018-04-27'), card('Counterspell', '7ed', '2001-04-11')] });
    if (q.includes('date<2001-04-11')) return json({ data: [card('Opt', 'mmq', '1999-10-04'), card('Counterspell', 'btd', '2000-10-01')] });
    return json({ data: [] });
  };
  const r = await Scryfall.fetchCards(['Opt', 'Contramagica'], { fetch: mock, useStorage: false });
  assert.deepEqual(r.missing, []);
  assert.equal(Scryfall.get('Opt').set, 'mmq');          // 1999 (2 anos) está mais perto de 2001 que 2018
  assert.equal(Scryfall.get('Contramagica').name, 'Counterspell');   // sem acento e sem maiúscula também acha
  assert.equal(Scryfall.get('Contramagica').set, '7ed');
  assert.ok(calls.some(u => u.includes('prefer')), 'buscou a mais antiga/mais nova');
});

test('se a busca de impressões falhar, fica a impressão padrão', async () => {
  const mock = async (url, opts = {}) => url.endsWith('/cards/collection') ? json({ data: [card('Brainstorm', 'new', '2024-01-01')] }) : { ok: false, status: 400, json: async () => ({}) };
  const r = await Scryfall.fetchCards(['Brainstorm'], { fetch: async (u, o) => mock(u, o).then(x => x), useStorage: false });
  assert.deepEqual(r.missing, []); assert.equal(Scryfall.get('Brainstorm').set, 'new');   // a busca falhou: mantém a padrão
});
