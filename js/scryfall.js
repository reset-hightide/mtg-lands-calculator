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
  const CACHE_KEY = 'mtg-lands:cards:v5';   // v5: impressões escolhidas pela proximidade da 7ª Edição
  const mem = new Map();          // nome minúsculo -> carta enxuta
  let storeLoaded = false;

  const SEVENTH = Date.UTC(2001, 3, 11);   // 7ª Edição (11/04/2001): a impressão preferida é a mais próxima desta data
  const BASICS = new Set(['plains', 'island', 'swamp', 'mountain', 'forest']);
  // só impressões normais em inglês e de papel: nada de promo, borda dourada/prateada, oversized, memorabilia ou sem texto
  const PRINT_FILTER = ' game:paper lang:en -is:promo -border:gold -border:silver -is:oversized -st:memorabilia -st:funny -is:textless';
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const key = n => n.toLowerCase();
  // a API só acha cartas de duas faces pelo nome da frente ("Fire // Ice" falha, "Fire" funciona)
  const front = n => n.split(' // ')[0];
  const norm = n => n.replace(/\s*\/{2,3}\s*/g, ' // ').replace(/’/g, "'").trim();

  /** Só os campos usados nas regras (mantém o cache pequeno). */
  function slim(c) {
    const o = {
      name: c.name, cmc: c.cmc, type_line: c.type_line, oracle_text: c.oracle_text, layout: c.layout, rarity: c.rarity,
      colors: c.colors, color_identity: c.color_identity, keywords: c.keywords, mana_cost: c.mana_cost, produced_mana: c.produced_mana, set: c.set, collector_number: c.collector_number,
      img: ((c.image_uris || (c.card_faces && c.card_faces[0] && c.card_faces[0].image_uris) || {}).normal) || null, uri: c.scryfall_uri,
    };
    if (c.card_faces) o.card_faces = c.card_faces.map(f => ({ name: f.name, type_line: f.type_line, oracle_text: f.oracle_text, colors: f.colors, mana_cost: f.mana_cost, produced_mana: f.produced_mana }));
    return o;
  }

  const days = p => Math.abs(Date.parse(p.released_at) - SEVENTH) / 864e5;
  const hasArt = p => !!((p.image_uris || (p.card_faces && p.card_faces[0] && p.card_faces[0].image_uris) || {}).normal) && p.image_status !== 'missing' && p.image_status !== 'placeholder';

  /**
   * Troca a impressão padrão (a mais nova) pela mais próxima da 7ª Edição, sempre em inglês, para as cartas ainda não refinadas.
   * Duas buscas por lote: a primeira impressão a partir de 11/04/2001 e a última antes dela; vence a mais perto. Terrenos básicos: da própria 7ª.
   * Se a busca falhar, fica a impressão padrão.
   */
  async function refinePrints(fetchFn, names) {
    const todo = [...new Set(names)].filter(n => { const c = mem.get(key(n)); return c && !c.pr; });
    const full = [...new Set(todo.map(n => mem.get(key(n)).name))];
    if (!full.length) return;
    const best = new Map(), asked = new Set();
    const consider = p => { if (!hasArt(p) || p.lang !== 'en') return; const k = key(p.name), d = days(p); if (!best.has(k) || d < best.get(k).d) best.set(k, { d, p }); };
    const run = async (q, order) => {
      let url = API + '/cards/search?q=' + encodeURIComponent(q) + '&unique=' + (order ? 'cards' : 'prints') + '&order=name';
      for (let page = 0; url && page < 6; page++) {
        const res = await api(fetchFn, url, { headers: { Accept: 'application/json' } });
        if (res.status === 404) return true;   // nenhuma impressão: tudo bem
        if (!res.ok) return false;
        const j = await res.json();
        for (const p of j.data || []) consider(p);
        url = j.has_more ? j.next_page : null;
      }
      return !url;
    };
    const or = ns => '(' + ns.map(n => '!"' + n.replace(/"/g, '') + '"').join(' or ') + ')';
    const basics = full.filter(n => BASICS.has(key(n))), rest = full.filter(n => !BASICS.has(key(n)));
    let ok = true;
    try {
      const jobs = [];   // todas as buscas do lote, rodando 3 por vez (o limite do Scryfall é ~10 por segundo)
      for (let i = 0; i < rest.length; i += 40) {
        const q = or(rest.slice(i, i + 40));
        jobs.push(() => run(q + ' date>=2001-04-11' + PRINT_FILTER + ' prefer:oldest', true), () => run(q + ' date<2001-04-11' + PRINT_FILTER + ' prefer:newest', true));
      }
      if (basics.length) jobs.push(() => run(or(basics) + ' set:7ed lang:en -is:promo', false));
      let next = 0;
      await Promise.all(Array.from({ length: Math.min(3, jobs.length) }, async () => { while (next < jobs.length) { if (!(await jobs[next++]())) ok = false; } }));
    } catch (_) { ok = false; }
    if (!ok) return;   // busca incompleta: mantém a impressão padrão e tenta de novo na próxima vez
    for (const [k, c] of mem.entries()) {
      const b = best.get(key(c.name)); if (!b || c.pr || !full.includes(c.name)) continue;
      const s = slim(b.p); s.pr = 1; mem.set(k, s);
    }
    for (const [k, c] of mem.entries()) if (full.includes(c.name)) c.pr = 1;   // sem impressão melhor: fica como está
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
    // nomes em português (ou outro idioma) que o Scryfall não conhece pelo nome em inglês: acha pelo nome impresso e traz a carta em inglês
    const pending = wanted.filter(n => !mem.has(key(n)));
    const byOracle = new Map();
    for (const n of pending) {
      try {
        await sleep(110);
        const res = await api(fetchFn, API + '/cards/search?q=' + encodeURIComponent('lang:pt "' + front(n).replace(/"/g, '') + '"') + '&include_multilingual=true&unique=cards', { headers: { Accept: 'application/json' } });
        if (!res.ok) continue;
        const flat = s => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
        const hit = ((await res.json()).data || []).find(c => c.printed_name && flat(c.printed_name.split(' // ')[0]) === flat(front(n)));
        if (hit && hit.oracle_id) byOracle.set(n, hit.oracle_id);
      } catch (_) { /* segue para a busca aproximada */ }
    }
    if (byOracle.size) {
      const ids = [...new Set(byOracle.values())];
      const res = await api(fetchFn, API + '/cards/collection', { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify({ identifiers: ids.map(oracle_id => ({ oracle_id })) }) });
      if (res.ok) {
        const en = new Map(); for (const c of (await res.json()).data) { en.set(c.oracle_id, index(c)); }
        for (const [n, id] of byOracle) if (en.has(id)) mem.set(key(n), en.get(id));
      }
    }
    const missing = [];
    for (const n of wanted) {
      if (mem.has(key(n))) continue;
      await sleep(110);
      const res = await api(fetchFn, API + '/cards/named?fuzzy=' + encodeURIComponent(n), { headers: { Accept: 'application/json' } });
      if (res.ok) { const c = index(await res.json()); mem.set(key(n), c); } else missing.push(n);
    }
    if (opts.oldestPrint !== false) await refinePrints(fetchFn, wanted.filter(n => mem.has(key(n))));
    if (opts.useStorage !== false) saveStore();
    return { missing };
  }

  const get = name => mem.get(key(norm(name)));
  const clear = () => { mem.clear(); try { localStorage.removeItem(CACHE_KEY); } catch (_) {} };

  return { fetchCards, get, clear, slim, norm };
});
