/*
 * Cliente mínimo da API do Scryfall (https://scryfall.com/docs/api), que está sempre atualizada com novos sets.
 * Busca em lote (/cards/collection, 75 por requisição) com cache local de 7 dias e reserva (fuzzy) para nomes não encontrados.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Scryfall = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const API = 'https://api.scryfall.com';
  const TTL_MS = 7 * 24 * 3600 * 1000;
  const CACHE_KEY = 'mtg-lands:cards:v2';
  const mem = new Map();          // nome minúsculo -> carta enxuta
  let storeLoaded = false;

  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const key = n => n.toLowerCase();
  // a API só acha cartas de duas faces pelo nome da frente ("Fire // Ice" falha, "Fire" funciona)
  const front = n => n.split(' // ')[0];
  const norm = n => n.replace(/\s*\/{2,3}\s*/g, ' // ').replace(/’/g, "'").trim();

  /** Só os campos usados nas regras (mantém o cache pequeno). */
  function slim(c) {
    const o = {
      name: c.name, cmc: c.cmc, type_line: c.type_line, oracle_text: c.oracle_text, layout: c.layout, rarity: c.rarity,
      colors: c.colors, color_identity: c.color_identity, keywords: c.keywords, mana_cost: c.mana_cost, produced_mana: c.produced_mana,
    };
    if (c.card_faces) o.card_faces = c.card_faces.map(f => ({ name: f.name, type_line: f.type_line, oracle_text: f.oracle_text, colors: f.colors, mana_cost: f.mana_cost, produced_mana: f.produced_mana }));
    return o;
  }

  function loadStore() {
    if (storeLoaded) return;
    storeLoaded = true;
    try {
      const raw = typeof localStorage !== 'undefined' && localStorage.getItem(CACHE_KEY);
      if (!raw) return;
      const { t, cards } = JSON.parse(raw);
      if (Date.now() - t > TTL_MS) { localStorage.removeItem(CACHE_KEY); return; }
      for (const [k, c] of cards) mem.set(k, c);
    } catch (_) { /* cache corrompido: ignora */ }
  }
  function saveStore() {
    try {
      if (typeof localStorage === 'undefined') return;
      const old = localStorage.getItem(CACHE_KEY);
      const t = old ? JSON.parse(old).t : Date.now();   // TTL conta a partir da criação do cache
      localStorage.setItem(CACHE_KEY, JSON.stringify({ t, cards: [...mem.entries()] }));
    } catch (_) { /* cota cheia: segue só com memória */ }
  }

  function index(card) {
    const s = slim(card);
    mem.set(key(s.name), s);
    if (s.card_faces) for (const f of s.card_faces) if (!mem.has(key(f.name))) mem.set(key(f.name), s);   // aceita só a face da frente
    return s;
  }

  async function api(fetchFn, url, opts) {
    for (let attempt = 0; attempt < 4; attempt++) {
      const res = await fetchFn(url, opts);
      if (res.status === 429 || res.status >= 500) { await sleep(500 * (attempt + 1)); continue; }
      return res;
    }
    throw new Error('Scryfall indisponível no momento. Tente de novo em instantes.');
  }

  /**
   * Garante que todas as cartas de `names` estão no cache. Retorna { missing: [nomes não encontrados] }.
   * opts: { fetch, onProgress(done,total), useStorage }
   */
  async function fetchCards(names, opts = {}) {
    const fetchFn = opts.fetch || fetch.bind(globalThis);
    if (opts.useStorage !== false) loadStore();
    const wanted = [...new Set(names.map(norm))];
    const need = wanted.filter(n => !mem.has(key(n)));
    for (let i = 0; i < need.length; i += 75) {
      const chunk = need.slice(i, i + 75);
      const res = await api(fetchFn, API + '/cards/collection', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ identifiers: chunk.map(name => ({ name: front(name) })) }),
      });
      if (!res.ok) throw new Error('Scryfall respondeu ' + res.status);
      const json = await res.json();
      for (const c of json.data) index(c);
      if (opts.onProgress) opts.onProgress(Math.min(i + 75, need.length), need.length);
      if (i + 75 < need.length) await sleep(110);   // limite do Scryfall: ~10 req/s
    }
    const missing = [];
    for (const n of wanted) {
      if (mem.has(key(n))) continue;
      await sleep(110);
      const res = await api(fetchFn, API + '/cards/named?fuzzy=' + encodeURIComponent(n), { headers: { Accept: 'application/json' } });
      if (res.ok) { const c = index(await res.json()); mem.set(key(n), c); } else missing.push(n);
    }
    if (opts.useStorage !== false) saveStore();
    return { missing };
  }

  const get = name => mem.get(key(norm(name)));
  const clear = () => { mem.clear(); try { localStorage.removeItem(CACHE_KEY); } catch (_) {} };

  return { fetchCards, get, clear, slim, norm };
});
