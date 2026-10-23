/*
 * Busca de decks de Commander em um site: o EDHREC publica JSON aberto (com CORS), então o navegador consulta direto, sem servidor.
 *  - /commanders/year.json: os comandantes mais populares do ano;
 *  - /average-decks/<comandante>.json: o deck médio de cada um (100 cartas).
 * DeckApi.randomCommanderDeck() -> { name, slug, url, text, cards } | null. O texto sai no formato "Commander / Deck" que o
 * leitor de listas do site já entende (Arena/MTGO/Moxfield), então o resultado entra direto na calculadora.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.DeckApi = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  const BASE = 'https://json.edhrec.com/pages';
  const cache = {};

  async function getJson(path, fetchFn, ms) {
    const f = fetchFn || fetch, ctl = typeof AbortController !== 'undefined' ? new AbortController() : null, t = ctl && setTimeout(() => ctl.abort(), ms || 9000);
    try {
      const r = await f(BASE + path, ctl ? { signal: ctl.signal } : undefined);
      if (!r.ok) throw new Error('EDHREC respondeu ' + r.status);
      return await r.json();
    } finally { if (t) clearTimeout(t); }
  }

  /** Comandantes populares: [{ name, slug, decks }] (mais usados primeiro). */
  async function topCommanders(period, fetchFn) {
    period = period || 'year';
    if (cache[period]) return cache[period];
    const j = await getJson('/commanders/' + period + '.json', fetchFn);
    const lists = (((j.container || {}).json_dict || {}).cardlists) || [];
    cache[period] = lists.flatMap(l => l.cardviews || []).filter(v => v.sanitized && v.name).map(v => ({ name: v.name, slug: v.sanitized, decks: v.num_decks || 0 }));
    return cache[period];
  }

  /** Deck médio do comandante: { commanders: [[nome, qtd]], cards: [[nome, qtd]] }. */
  async function averageDeck(slug, fetchFn) {
    const j = await getJson('/average-decks/' + encodeURIComponent(slug) + '.json', fetchFn);
    const d = j.deck || {}, cmd = d.commander_v2 || (d.commander || []).map(n => [n, 1]), cards = [];
    for (const arr of Object.values(d.cards || {})) for (const [n, q] of arr) cards.push([n, q]);
    return { commanders: cmd, cards };
  }

  /** Lista no formato que o site lê: seção "Commander" e seção "Deck". */
  function toText(d) {
    return 'Commander\n' + d.commanders.map(([n, q]) => `${q || 1} ${n}`).join('\n') + '\n\nDeck\n' + d.cards.map(([n, q]) => `${q} ${n}`).join('\n') + '\n';
  }

  /**
   * Sorteia um comandante entre os mais populares e devolve o deck médio dele. `top` limita o sorteio aos N primeiros.
   * Em caso de falha de rede devolve null (quem chama usa um deck de exemplo local).
   */
  async function randomCommanderDeck(opts) {
    opts = opts || {};
    const rnd = opts.rnd || Math.random, top = opts.top || 150;
    try {
      const list = (await topCommanders(opts.period, opts.fetch)).slice(0, top);
      for (let tries = 0; tries < 3 && list.length; tries++) {
        const pick = list[Math.floor(rnd() * list.length)];
        try {
          const d = await averageDeck(pick.slug, opts.fetch);
          if (d.cards.length < 30) continue;   // deck vazio ou incompleto: tenta outro
          return { name: pick.name, slug: pick.slug, url: 'https://edhrec.com/average-decks/' + pick.slug, text: toText(d), cards: d.cards, commanders: d.commanders, source: 'EDHREC' };
        } catch (e) { /* tenta outro comandante */ }
      }
    } catch (e) { /* sem rede ou site fora do ar */ }
    return null;
  }

  return { topCommanders, averageDeck, toText, randomCommanderDeck };
});
