/*
 * Playtest livre: um grimório no canto da tela e uma mesa onde as cartas vão para onde você arrastar.
 * Sem zonas fixas. Clique no grimório para comprar; arraste a carta da mão para a mesa (e de volta); duplo clique vira a
 * carta (ou joga, se estiver na mão); clique seleciona e mostra as ações (topo/fundo do grimório, cemitério).
 * Playtest.open(cards): cards = [{ name, qty, cls, card, commander }] (saída de analyzeEntries). Usa pointer events (mouse e toque).
 */
(function (root) {
  'use strict';
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const rnd = n => root.crypto.getRandomValues(new Uint32Array(1))[0] % n;
  const shuffle = a => { for (let i = a.length - 1; i > 0; i--) { const j = rnd(i + 1); [a[i], a[j]] = [a[j], a[i]]; } return a; };
  const RATIO = 680 / 488;

  const GRIMOIRE = `<svg viewBox="0 0 84 100" aria-hidden="true"><rect x="12" y="8" width="64" height="84" rx="7" fill="#3a2a5c" stroke="#d3b341" stroke-width="3"/>
    <rect x="3" y="12" width="14" height="78" rx="5" fill="#2b1f47" stroke="#d3b341" stroke-width="2"/>
    <circle cx="45" cy="46" r="16" fill="none" stroke="#d3b341" stroke-width="2.5"/>
    <path d="M45 31l4.2 11.6 12.3 .4-9.8 7.6 3.5 11.8L45 55l-10.2 7.4 3.5-11.8-9.8-7.6 12.3-.4z" fill="#d3b341"/>
    <rect x="68" y="40" width="12" height="17" rx="2.5" fill="#d3b341"/></svg>`;

  let ov = null, S = null, zTop = 10, last = { id: null, t: 0 };

  const $ = sel => ov.querySelector(sel);
  const cardW = () => Math.max(80, Math.min(124, root.innerWidth * 0.082));
  const handW = () => Math.max(86, Math.min(138, root.innerWidth * 0.094));
  const faceHtml = c => c.img ? `<img src="${esc(c.img)}" alt="${esc(c.name)}" draggable="false">` : `<div class="noimg">${esc(c.name)}</div>`;

  // ------------------------------------------------------------------ estado
  function build(cards) {
    let n = 0; const all = [];
    for (const e of cards) for (let i = 0; i < e.qty; i++) all.push({ id: ++n, name: e.card.name || e.name, img: e.card.img, uri: e.card.uri, land: !!e.cls.isLand, commander: !!e.commander, where: 'lib', x: 0, y: 0, tapped: false, z: 0 });
    return { all, lib: [], hand: [], table: [], gy: [], turn: 1, life: 20, mull: 0, sel: null, big: all.length >= 99 };
  }
  const bucket = c => S[c.where];
  function detach(c) { const a = bucket(c); const i = a.indexOf(c); if (i >= 0) a.splice(i, 1); }
  function moveTo(c, where, opts) {
    opts = opts || {};
    detach(c); c.where = where;
    if (where === 'lib') { c.tapped = false; opts.bottom ? S.lib.push(c) : S.lib.unshift(c); }
    else if (where === 'hand') { c.tapped = false; if (opts.index == null) S.hand.push(c); else S.hand.splice(opts.index, 0, c); }
    else if (where === 'table') { c.x = opts.x; c.y = opts.y; c.z = ++zTop; S.table.push(c); }
    else if (where === 'gy') { c.tapped = false; S.gy.push(c); }
  }
  function newGame(mull, startHand) {
    S.mull = mull ? S.mull + 1 : 0;
    S.lib = []; S.hand = []; S.table = []; S.gy = []; S.sel = null; S.turn = 1;
    if (!mull) S.life = S.big ? 40 : 20;
    const lib = [];
    for (const c of S.all) { c.tapped = false; if (c.commander) { c.where = 'table'; c.x = 18; c.y = 76; c.z = ++zTop; S.table.push(c); } else { c.where = 'lib'; lib.push(c); } }
    S.lib = shuffle(lib);
    if (startHand && startHand.length) {   // mesma mão que o site acabou de mostrar
      for (const name of startHand) { const i = S.lib.findIndex(c => c.name === name); if (i >= 0) { const c = S.lib.splice(i, 1)[0]; c.where = 'hand'; S.hand.push(c); } }
    }
    draw(7 - S.hand.length);
  }
  function draw(n) {
    let got = 0;
    for (let i = 0; i < n; i++) { const c = S.lib.shift(); if (!c) { say('O grimório está vazio.'); break; } c.where = 'hand'; c.fresh = true; S.hand.push(c); got++; }
    render(); return got;
  }
  function say(t) { const m = $('.pt-msg'); m.textContent = t; m.classList.add('on'); clearTimeout(say.t); say.t = setTimeout(() => m.classList.remove('on'), 2200); }

  // ------------------------------------------------------------------ desenho
  function render() {
    if (!ov) return;
    // mão: sobrepõe as cartas quando não cabem
    const tray = $('.pt-hand'), hw = handW(), n = S.hand.length, avail = Math.max(200, tray.clientWidth - 24);
    const overlap = n > 1 ? Math.max(-6, Math.min(0, (avail - n * hw) / (n - 1))) : 0;
    tray.style.setProperty('--hw', hw + 'px');
    tray.innerHTML = S.hand.map((c, i) => `<div class="ptc hand${c.land ? ' land' : ''}${c.fresh ? ' fresh' : ''}${S.sel === c ? ' sel' : ''}" data-id="${c.id}" style="margin-left:${i ? overlap : 0}px" title="${esc(c.name)}">${faceHtml(c)}</div>`).join('');
    S.hand.forEach(c => { c.fresh = false; });
    // mesa
    const tb = $('.pt-table'), tw = cardW();
    tb.style.setProperty('--tw', tw + 'px');
    const W = ov.clientWidth, H = ov.clientHeight;
    tb.innerHTML = S.table.map(c => {
      const x = Math.max(0, Math.min(W - tw, c.x)), y = Math.max(0, Math.min(H - tw * RATIO, c.y));
      return `<div class="ptc tbl${c.land ? ' land' : ''}${c.tapped ? ' tapped' : ''}${S.sel === c ? ' sel' : ''}" data-id="${c.id}" style="left:${x}px;top:${y}px;z-index:${c.z}" title="${esc(c.name)}">${faceHtml(c)}</div>`;
    }).join('');
    // grimório, contadores e barra de ação
    $('.pt-lib-n').textContent = S.lib.length;
    $('.pt-libinfo').textContent = `${S.lib.length} carta(s), ${S.lib.filter(c => c.land).length} terreno(s)`;
    $('.pt-grim').classList.toggle('empty', !S.lib.length);
    $('.pt-gy-n').textContent = S.gy.length;
    $('.pt-turn').textContent = S.turn; $('.pt-life').textContent = S.life;
    $('.pt-hand-n').textContent = `${S.hand.length} na mão`;
    const sel = S.sel, bar = $('.pt-sel');
    if (sel) {
      const w = sel.where;
      bar.innerHTML = `<b>${esc(sel.name)}</b>` + (w === 'hand' ? '<button data-a="play">Jogar na mesa</button>' : w === 'table' ? `<button data-a="tap">${sel.tapped ? 'Desvirar' : 'Virar'}</button><button data-a="hand">Para a mão</button>` : '')
        + '<button data-a="top">Topo do grimório</button><button data-a="bottom">Fundo do grimório</button><button data-a="gy">Cemitério</button>' + (sel.uri ? `<a href="${esc(sel.uri)}" target="_blank" rel="noopener">Scryfall ↗</a>` : '');
      bar.classList.remove('hidden');
    } else bar.classList.add('hidden');
  }

  // ------------------------------------------------------------------ arrastar
  const cardOf = el => { const id = +el.closest('.ptc').dataset.id; return S.all.find(c => c.id === id); };
  const hit = (el, x, y) => { const r = el.getBoundingClientRect(); return x >= r.left && x <= r.right && y >= r.top && y <= r.bottom; };

  function onDown(e) {
    const el = e.target.closest('.ptc');
    if (!el || (e.button != null && e.button > 0)) return;
    e.preventDefault();
    const c = cardOf(el), from = c.where, sx = e.clientX, sy = e.clientY, tw = cardW();
    const ox = from === 'table' ? sx - c.x : tw / 2, oy = from === 'table' ? sy - c.y : tw * RATIO / 2;
    let moved = false, ghost = null;
    const place = (x, y) => { const t = ghost || el; t.style.left = (x - ox) + 'px'; t.style.top = (y - oy) + 'px'; };
    const move = ev => {
      if (!moved && Math.hypot(ev.clientX - sx, ev.clientY - sy) < 6) return;
      if (!moved) {
        moved = true; $('.pt-prev').classList.remove('on');
        if (from === 'table') el.style.zIndex = ++zTop;
        else { ghost = el.cloneNode(true); ghost.className = 'ptc tbl ghost'; ghost.style.marginLeft = '0'; ghost.style.setProperty('--tw', tw + 'px'); ov.appendChild(ghost); el.style.opacity = '.25'; }
      }
      place(ev.clientX, ev.clientY);
      $('.pt-hand').classList.toggle('drop', hit($('.pt-hand'), ev.clientX, ev.clientY));
      $('.pt-grim').classList.toggle('drop', hit($('.pt-grim'), ev.clientX, ev.clientY));
    };
    const up = ev => {
      root.removeEventListener('pointermove', move); root.removeEventListener('pointerup', up); root.removeEventListener('pointercancel', up);
      $('.pt-hand').classList.remove('drop'); $('.pt-grim').classList.remove('drop');
      if (ghost) ghost.remove();
      if (!moved) return clicked(c, from);
      if (hit($('.pt-grim'), ev.clientX, ev.clientY)) { moveTo(c, 'lib'); S.sel = null; }
      else if (hit($('.pt-hand'), ev.clientX, ev.clientY)) {
        const kids = [...$('.pt-hand').querySelectorAll('.ptc')].filter(k => +k.dataset.id !== c.id);
        let idx = kids.findIndex(k => { const r = k.getBoundingClientRect(); return ev.clientX < r.left + r.width / 2; }); if (idx < 0) idx = kids.length;
        moveTo(c, 'hand', { index: idx });
      } else { moveTo(c, 'table', { x: Math.max(0, Math.min(ov.clientWidth - tw, ev.clientX - ox)), y: Math.max(0, Math.min(ov.clientHeight - tw * RATIO, ev.clientY - oy)) }); S.sel = c; }
      render();
    };
    root.addEventListener('pointermove', move); root.addEventListener('pointerup', up); root.addEventListener('pointercancel', up);
  }

  /** Clique sem arrastar: seleciona; segundo clique rápido na mesma carta = virar (mesa) ou jogar (mão). */
  function clicked(c, from) {
    const now = Date.now();
    if (last.id === c.id && now - last.t < 380) { last.id = null; if (from === 'table') c.tapped = !c.tapped; else playHand(c); S.sel = c; return render(); }
    last = { id: c.id, t: now };
    S.sel = c; render();
  }
  function playHand(c) {
    const tw = cardW(), n = S.table.length, W = ov.clientWidth, H = ov.clientHeight;
    const x = Math.min(W - tw - 150, 160 + (n % 9) * (tw * 0.55) + Math.floor(n / 9) * 16), y = Math.max(70, H * 0.22) + Math.floor(n / 9) % 3 * (tw * RATIO * 0.5);
    moveTo(c, 'table', { x, y });
  }

  // ------------------------------------------------------------------ ações
  function act(a) {
    const c = S.sel; if (!c) return;
    if (a === 'tap') c.tapped = !c.tapped;
    else if (a === 'play') playHand(c);
    else if (a === 'hand') moveTo(c, 'hand');
    else if (a === 'top') { moveTo(c, 'lib'); S.sel = null; }
    else if (a === 'bottom') { moveTo(c, 'lib', { bottom: true }); S.sel = null; }
    else if (a === 'gy') { moveTo(c, 'gy'); S.sel = null; }
    render();
  }
  function openGy() {
    const p = $('.pt-gypanel');
    p.innerHTML = `<div class="pt-gyhead"><b>Cemitério (${S.gy.length})</b><span>clique numa carta para devolvê-la à mão</span><button data-a="gyclose">Fechar</button></div><div class="pt-gylist">${S.gy.map(c => `<div class="ptc gyc" data-id="${c.id}" title="${esc(c.name)}">${faceHtml(c)}</div>`).join('') || '<p>Vazio.</p>'}</div>`;
    p.classList.remove('hidden');
  }

  // ------------------------------------------------------------------ abrir / fechar
  function close() { if (!ov) return; root.removeEventListener('keydown', onKey); root.removeEventListener('resize', render); ov.remove(); ov = null; S = null; document.body.classList.remove('pt-open'); const f = document.getElementById('btnGrimoire'); if (f) f.focus(); }
  function onKey(e) {
    if (e.key === 'Escape') { const p = $('.pt-gypanel'); if (!p.classList.contains('hidden')) p.classList.add('hidden'); else close(); }
    else if (e.key === 'd' || e.key === 'D') draw(1);
    else if ((e.key === 't' || e.key === 'T') && S.sel && S.sel.where === 'table') act('tap');
  }

  function open(cards, opts) {
    close();
    S = build(cards);
    ov = document.createElement('div');
    ov.className = 'pt-ov'; ov.setAttribute('role', 'dialog'); ov.setAttribute('aria-label', 'Playtest');
    ov.innerHTML = `<div class="pt-table"></div>
      <div class="pt-top"><b class="pt-title">Playtest</b>
        <button data-a="draw">Comprar (D)</button><button data-a="turn">Próximo turno</button><button data-a="untap">Desvirar tudo</button>
        <button data-a="mull">Mulligan</button><button data-a="new">Novo jogo</button>
        <span class="pt-cnt">Turno <b class="pt-turn"></b></span>
        <span class="pt-cnt">Grimório: <b class="pt-libinfo"></b></span>
        <span class="pt-cnt pt-lifebox"><button data-a="lm" aria-label="Menos 1 de vida">−</button>Vida <b class="pt-life"></b><button data-a="lp" aria-label="Mais 1 de vida">+</button></span>
        <button data-a="gy">Cemitério (<span class="pt-gy-n">0</span>)</button>
        <button class="pt-x" data-a="close" aria-label="Fechar o playtest">✕</button></div>
      <div class="pt-sel hidden"></div>
      <div class="pt-msg" role="status"></div>
      <div class="pt-prev"><img alt=""></div>
      <div class="pt-hand" aria-label="Sua mão"></div><span class="pt-hand-n"></span>
      <button class="pt-grim" data-a="draw" aria-label="Grimório: clique para comprar uma carta" title="Grimório: clique para comprar (ou arraste uma carta para cá para devolvê-la)">${GRIMOIRE}<span class="pt-lib-n">0</span></button>
      <div class="pt-gypanel hidden"></div>
      <p class="pt-help">Clique no grimório para comprar · arraste as cartas para a mesa (e de volta para a mão ou o grimório) · duplo clique vira a carta · T vira a selecionada</p>`;
    document.body.appendChild(ov); document.body.classList.add('pt-open');
    ov.addEventListener('pointerdown', e => { if (e.target.closest('.pt-hand .ptc, .pt-table .ptc')) onDown(e); });
    ov.addEventListener('pointerdown', e => { if (e.target === $('.pt-table')) { S.sel = null; render(); } });
    ov.addEventListener('click', e => {
      const b = e.target.closest('[data-a]'); if (b) {
        const a = b.dataset.a;
        if (a === 'draw') { draw(1); if (S) { const h = $('.pt-hand'); h.classList.add('pulse'); setTimeout(() => h.classList.remove('pulse'), 300); } }
        else if (a === 'turn') { S.table.forEach(c => { c.tapped = false; }); S.turn++; draw(1); }
        else if (a === 'untap') { S.table.forEach(c => { c.tapped = false; }); render(); }
        else if (a === 'mull') { newGame(true); say(`Mulligan ${S.mull}: devolva ${S.mull} carta(s) ao fundo do grimório (selecione e use "Fundo do grimório").`); }
        else if (a === 'new') { newGame(false); say('Novo jogo: grimório embaralhado e 7 cartas na mão.'); }
        else if (a === 'lm') { S.life--; render(); } else if (a === 'lp') { S.life++; render(); }
        else if (a === 'gy') { if (b.closest('.pt-top')) openGy(); else act('gy'); }
        else if (a === 'gyclose') $('.pt-gypanel').classList.add('hidden');
        else if (a === 'close') close();
        else act(a);
        return;
      }
      const g = e.target.closest('.gyc'); if (g) { const c = S.all.find(x => x.id === +g.dataset.id); moveTo(c, 'hand'); render(); openGy(); }
    });
    // pré-visualização grande ao passar o mouse
    ov.addEventListener('mouseover', e => {
      const el = e.target.closest('.ptc'); const pv = $('.pt-prev');
      if (!el || el.classList.contains('ghost')) return pv.classList.remove('on');
      const c = S.all.find(x => x.id === +el.dataset.id); if (!c || !c.img) return;
      pv.querySelector('img').src = c.img; pv.classList.add('on');
    });
    ov.addEventListener('mouseout', e => { if (!e.relatedTarget || !e.relatedTarget.closest || !e.relatedTarget.closest('.ptc')) $('.pt-prev').classList.remove('on'); });
    root.addEventListener('keydown', onKey); root.addEventListener('resize', render);
    newGame(false, opts && opts.hand);
    $('.pt-grim').focus();
  }

  root.Playtest = { open, close };
})(typeof self !== 'undefined' ? self : this);
