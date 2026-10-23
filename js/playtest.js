/*
 * Playtest em cima do próprio site (é uma zoeira): um grimório com o verso de Magic aparece só 1/4 na borda direita.
 * Arraste uma carta da mão para qualquer lugar da página e ela fica ali, por cima das tabelas; clique no grimório para
 * comprar. Sem zonas nem barras: enquanto você joga, o texto e os números do site deixam de ser selecionáveis.
 * Duplo clique vira a carta; arraste de volta para a mão, para o comandante ou para o grimório para guardá-la. Esc encerra.
 * Playtest.init({ fan, cmd, grim, end, renderFan(cartas), context() -> { cards, hand } | null, stopped() }).
 * As quantidades vêm do deck calculado: o grimório é o deck menos a mão (e menos o comandante).
 */
(function (root) {
  'use strict';
  const rnd = n => root.crypto.getRandomValues(new Uint32Array(1))[0] % n;
  const shuffle = a => { for (let i = a.length - 1; i > 0; i--) { const j = rnd(i + 1); [a[i], a[j]] = [a[j], a[i]]; } return a; };
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const RATIO = 680 / 488;

  let H = null;                 // ganchos do app
  let P = null;                 // partida em andamento: { all, lib, hand, table, cmd } (null = site normal)
  let dragging = 0, zTop = 3000;

  /** Largura da carta da mão (a mesma da mesa). Mede a carta do leque; se ainda não existe, usa a mesma fórmula do CSS. */
  const cardW = () => { const fc = H && H.fan.querySelector('.fc'); return (fc && fc.offsetWidth) || Math.max(92, Math.min(180, root.innerWidth * 0.155)); };
  const hit = (el, x, y) => { if (!el) return false; const r = el.getBoundingClientRect(); return r.width > 0 && x >= r.left - 8 && x <= r.right + 8 && y >= r.top - 8 && y <= r.bottom + 8; };
  const face = c => c.img ? `<img src="${esc(c.img)}" alt="${esc(c.name)}" draggable="false">` : `<span class="ptn">${esc(c.name)}</span>`;
  const find = id => P && (P.all.find(c => c.id === id) || P.cmd.find(c => c.id === id));

  // ------------------------------------------------------------------ partida
  function start() {
    if (P) return P;
    const ctx = H.context(); if (!ctx) return null;
    let n = 0; const all = [], cmd = [];
    for (const e of ctx.cards) for (let i = 0; i < e.qty; i++) {
      const c = { id: ++n, name: e.card.name || e.name, img: e.card.img, uri: e.card.uri, land: !!e.cls.isLand, produced: (e.card.produced_mana || []).slice(), colors: e.card.colors || [], prof: root.PtFx ? root.PtFx.analyze(e.card) : { type: '' }, where: 'lib', x: 0, y: 0, z: 0, tapped: false };
      if (e.commander) { c.where = 'cmd'; cmd.push(c); } else all.push(c);
    }
    const lib = shuffle(all.slice()), hand = [];
    for (const name of ctx.hand || []) { const i = lib.findIndex(c => c.name === name); if (i >= 0) { const c = lib.splice(i, 1)[0]; c.where = 'hand'; hand.push(c); } }   // começa com a mão que a página mostrou
    P = { all, lib, hand, table: [], cmd, gy: [] };
    document.body.classList.add('pt-playing'); H.end.classList.remove('hidden');
    refresh();
    return P;
  }
  function stop() {
    if (!P) return;
    document.querySelectorAll('.ptcard').forEach(e => e.remove());
    if (root.PtFx) root.PtFx.fx.clear();   // limpa as marcas de queimado
    P = null; document.body.classList.remove('pt-playing'); H.end.classList.add('hidden');
    H.cmd.querySelectorAll('.cmdcard').forEach(el => { el.style.visibility = ''; });
    H.stopped && H.stopped();
    badge();
  }
  function badge() { const b = H.grim.querySelector('.gcount'); b.textContent = P ? P.lib.length : ''; H.grim.classList.toggle('on', !!P); }
  function refresh(freshId) {
    H.renderFan(P.hand.map(c => ({ name: c.name, img: c.img, uri: c.uri, isLand: c.land, pid: c.id, fresh: c.id === freshId })));
    H.cmd.querySelectorAll('.cmdcard').forEach((el, i) => { const c = P.cmd[i]; el.dataset.pid = c ? c.id : ''; el.style.visibility = c && c.where !== 'cmd' ? 'hidden' : ''; });
    badge();
    const fresh = H.fan.querySelector('.fc.fresh');   // carta recém-comprada: parte do grimório e voa até o lugar dela na mão
    if (fresh) {
      fresh.style.setProperty('animation', 'none', 'important');   // mede a posição final, sem a animação já deslocando a carta
      const g = H.grim.getBoundingClientRect(), r = fresh.getBoundingClientRect();
      fresh.style.setProperty('--fx', (g.left + 36 - (r.left + r.width / 2)) + 'px'); fresh.style.setProperty('--fy', (g.top + g.height / 2 - (r.top + r.height / 2)) + 'px');
      void fresh.offsetWidth; fresh.style.removeProperty('animation');   // agora a animação parte do grimório
      H.grim.classList.add('pull'); setTimeout(() => H.grim.classList.remove('pull'), 450);
    }
  }
  function flash(t) { let m = document.getElementById('ptmsg'); if (!m) { m = document.createElement('div'); m.id = 'ptmsg'; document.body.appendChild(m); } m.textContent = t; m.classList.add('on'); clearTimeout(flash.t); flash.t = setTimeout(() => m.classList.remove('on'), 1800); }
  function draw() {
    if (!start()) return;
    const c = P.lib.shift();
    if (!c) { H.grim.classList.add('empty-shake'); setTimeout(() => H.grim.classList.remove('empty-shake'), 450); return; }   // vazio: o grimório só balança
    c.where = 'hand'; P.hand.push(c); refresh(c.id);
  }

  // ------------------------------------------------------------------ cartas por cima da página
  function tableEl(c) {
    let el = document.querySelector(`.ptcard[data-pid="${c.id}"]:not(.ghost)`);
    if (!el) { el = document.createElement('div'); el.className = 'ptcard'; el.dataset.pid = c.id; el.title = c.name + ' (clique para virar)'; el.innerHTML = face(c); document.body.appendChild(el); }
    el.style.width = cardW() + 'px'; el.style.left = c.x + 'px'; el.style.top = c.y + 'px'; el.style.zIndex = c.z; el.classList.toggle('tapped', c.tapped);
    return el;
  }
  function detach(c) {
    const a = c.where === 'lib' ? P.lib : c.where === 'hand' ? P.hand : c.where === 'table' ? P.table : c.where === 'gy' ? P.gy : null;
    if (a && a.indexOf(c) >= 0) a.splice(a.indexOf(c), 1);
  }
  function leave(c) {
    detach(c);
    if (c.where === 'table') { const el = document.querySelector(`.ptcard[data-pid="${c.id}"]:not(.ghost)`); if (el) el.remove(); }
  }
  function toTable(c, x, y) { leave(c); c.where = 'table'; c.x = Math.max(0, Math.min(root.document.documentElement.scrollWidth - cardW(), x)); c.y = Math.max(0, y); c.z = ++zTop; P.table.push(c); tableEl(c); }
  function toHand(c) { leave(c); c.where = 'hand'; c.tapped = false; P.hand.push(c); }
  function toLib(c) { leave(c); c.where = 'lib'; c.tapped = false; P.lib.unshift(c); }
  function toCmd(c) { leave(c); c.where = 'cmd'; c.tapped = false; }

  // ------------------------------------------------------------------ arrastar (mouse e toque)
  /** resolve() é chamado só quando o gesto vira arrasto de verdade: aí a partida começa (se ainda não começou). -> { c, el } */
  function startDrag(e, resolve) {
    const sx = e.clientX, sy = e.clientY;
    let c = null, el = null, fromTable = false, ox = 0, oy = 0, ghost = null, raf = 0, moved = false, last = e;
    const place = ev => {
      last = ev;
      if (fromTable) { c.x = ev.clientX + root.scrollX - ox; c.y = ev.clientY + root.scrollY - oy; tableEl(c).classList.add('drag'); }
      else { ghost.style.left = (ev.clientX - ox) + 'px'; ghost.style.top = (ev.clientY - oy) + 'px'; }
    };
    const scrollLoop = () => {   // perto da borda da tela: rola a página para alcançar outras tabelas
      const v = last.clientY < 70 ? -14 : last.clientY > root.innerHeight - 70 ? 14 : 0;
      if (v) { root.scrollBy(0, v); if (fromTable) place(last); }
      raf = requestAnimationFrame(scrollLoop);
    };
    const move = ev => {
      if (!moved && Math.hypot(ev.clientX - sx, ev.clientY - sy) < 6) return;
      if (!moved) {
        const r = resolve(); if (!r || !r.c) { cleanup(); return; }
        ({ c, el } = r); moved = true; dragging++; fromTable = c.where === 'table';
        const w = cardW(); ox = fromTable ? sx + root.scrollX - c.x : w / 2; oy = fromTable ? sy + root.scrollY - c.y : w * RATIO / 2;
        if (!fromTable) { ghost = document.createElement('div'); ghost.className = 'ptcard ghost'; ghost.style.width = w + 'px'; ghost.innerHTML = face(c); document.body.appendChild(ghost); if (el) el.style.opacity = '.25'; }
        else c.z = ++zTop;
        document.body.classList.add('pt-drag');
        raf = requestAnimationFrame(scrollLoop);
      }
      place(ev);
      H.grim.classList.toggle('drop', hit(H.grim, ev.clientX, ev.clientY));
    };
    const cleanup = () => { root.removeEventListener('pointermove', move); root.removeEventListener('pointerup', up); root.removeEventListener('pointercancel', up); cancelAnimationFrame(raf); };
    const up = ev => {
      cleanup(); H.grim.classList.remove('drop'); document.body.classList.remove('pt-drag');
      if (!moved) { const t = ev.target.closest && ev.target.closest('.ptcard'); if (t && P) { const k = find(+t.dataset.pid); if (k && k.where === 'table') tap(k); } return; }   // clique na carta da mesa: vira
      if (ghost) ghost.remove(); if (el) el.style.opacity = '';
      root.addEventListener('click', ck => { ck.preventDefault(); ck.stopPropagation(); }, { capture: true, once: true });   // o arrasto não pode abrir link nem comprar mão
      setTimeout(() => { dragging = Math.max(0, dragging - 1); }, 80);
      const x = ev.clientX, y = ev.clientY, px = x + root.scrollX - ox, py = y + root.scrollY - oy, isCmd = P.cmd.includes(c), was = c.where;
      let played = false;
      if (hit(H.grim, x, y)) { if (isCmd) { toTable(c, px, py); played = was !== 'table'; } else toLib(c); }
      else if (isCmd && hit(H.cmd, x, y)) toCmd(c);
      else if (!isCmd && hit(H.fan, x, y)) toHand(c);
      else { toTable(c, px, py); played = was !== 'table'; }
      refresh();
      if (played) cast(c, targetAt(x, y, c));   // jogou da mão na mesa: efeito da carta
    };
    root.addEventListener('pointermove', move); root.addEventListener('pointerup', up); root.addEventListener('pointercancel', up);
  }
  function tap(c) {   // clique vira / desvira. Fetch land: some e vem outro terreno aleatório no lugar.
    if (c.prof && c.prof.fetch && root.PtFx && !c.tapped) return crack(c);
    c.tapped = !c.tapped; tableEl(c);
    if (c.tapped && (c.land || (c.prof && c.prof.tapMana))) manaPop(c);
    if (c.tapped && c.land && root.PtFx) root.PtFx.fx.land(c.name, elOf(c));   // terreno virado: efeito discreto pelo nome
  }

  // ------------------------------------------------------------------ efeitos engraçados (por texto/tipo da carta)
  const FX = () => root.PtFx.fx;
  const elOf = c => document.querySelector(`.ptcard[data-pid="${c.id}"]:not(.ghost)`);
  /** Carta sai da mesa com animação (e vai para o cemitério invisível). */
  function exit(c, how) { const el = elOf(c); detach(c); c.where = 'gy'; if (el) FX().leave(el, how); }
  function targetAt(x, y, self) {   // carta da mesa embaixo do ponteiro (a de cima)
    for (const e of document.elementsFromPoint(x, y)) { const t = e.closest && e.closest('.ptcard:not(.ghost)'); if (t) { const k = find(+t.dataset.pid); if (k && k !== self && k.where === 'table') return k; } }
    return null;
  }
  function crack(c) {
    const lands = P.lib.filter(l => l.land), el = elOf(c);
    if (!lands.length) { FX().shake(el); return; }
    const l = lands[rnd(lands.length)], x = c.x, y = c.y;
    FX().poof(el); exit(c, 'burnaway'); shuffle(P.lib);
    setTimeout(() => { if (!P) return; toTable(l, x, y); l.tapped = false; FX().pop(tableEl(l)); badge(); }, 380);
  }
  /** Custo alternativo de verdade: sacrifica/devolve terrenos da mesa ou exila carta da mão. Sem como pagar: a carta volta para a mão. */
  function payAlt(c) {
    const a = c.prof.alt, F = FX(), others = P.table.filter(x => x !== c);
    if (a.kind === 'sacrifice' || a.kind === 'return') {
      const pool = others.filter(x => x.prof.land && new RegExp('\\b' + a.type + '\\b', 'i').test(x.prof.type));
      if (pool.length < a.n) return false;
      pool.slice(-a.n).forEach(x => { if (a.kind === 'sacrifice') exit(x, 'burnaway'); else { F.poof(elOf(x)); toHand(x); refresh(x.id); } });
      return true;
    }
    const pool = P.hand.filter(x => x.colors.includes(a.color));
    if (pool.length < a.n) return false;
    const gone = shuffle(pool.slice()).slice(0, a.n);
    gone.forEach(x => { const i = P.hand.indexOf(x), fc = H.fan.querySelectorAll('.fc')[i]; if (fc) FX().leave(fc, 'burnaway'); detach(x); x.where = 'gy'; });
    setTimeout(() => { if (P) refresh(); }, 520);
    return true;
  }
  function cast(c, target) {
    if (!root.PtFx || !P) return;
    const p = c.prof, el = elOf(c), F = FX();
    if (!p || !el) return;
    if (p.alt && !payAlt(c)) { F.shake(el); setTimeout(() => { if (P && c.where === 'table') { toHand(c); refresh(c.id); } }, 520); return; }
    let did = false;
    if (p.wrath) {   // varredor: a mesa treme e o que for do tipo gira para fora da tela
      did = true; F.quake(); F.crater(el, true); F.flash(); F.gag('gravity', el);   // a página racha e as letras caem
      P.table.filter(x => x !== c).forEach((x, i) => { if (elOf(x)) setTimeout(() => { if (P && x.where === 'table') exit(x, 'spin'); }, i * 60); });   // a Cólera de Deus acaba com o jogo: leva a mesa inteira
      setTimeout(() => { if (P) F.gameover(); }, 1500);
    } else if (p.damage || p.target) {
      if (p.damage) { F.flash(); did = true; F.scorch(target ? elOf(target) : el, p.damage); }   // chamusca a página
      if (target) {
        did = true; const te = elOf(target);
        if (p.damage) { F.burn(te); F.float(te, '💥'); }
        if (p.target === 'destroy') exit(target, 'shatter');
        else if (p.target === 'exile') exit(target, 'burnaway');
        else if (p.target === 'bounce') { F.poof(te); toHand(target); refresh(target.id); }
        else if (p.target === 'counter') { F.poof(te); toLib(target); refresh(); }
        else if (p.target === 'tap') { target.tapped = true; tableEl(target); }
      }
    }
    if (p.draw) { did = true; for (let i = 0; i < p.draw; i++) setTimeout(() => { if (P) draw(); }, 450 * (i + 1)); }
    if (p.ramp) {   // busca terreno: ele aparece na mesa (virado) ao lado, ou vem para a mão
      did = true; const lands = shuffle(P.lib.filter(l => l.land)), cw = cardW(); let k = 0;
      for (let i = 0; i < p.ramp.table && k < lands.length; i++, k++) { const l = lands[k]; toTable(l, c.x + (cw + 10) * (i + 1), c.y); l.tapped = true; F.pop(tableEl(l)); }
      for (let i = 0; i < p.ramp.hand && k < lands.length; i++, k++) { toHand(lands[k]); refresh(lands[k].id); }
      badge();
    }
    F.title(c.name, el, { damage: !!p.damage });   // efeitos pelas palavras do título
    if (did || p.alt) setTimeout(() => { if (P && c.where === 'table') exit(c, 'fade'); }, 1900);   // a mágica resolveu: vai para o cemitério
    else {   // sem efeito de mágica: um efeito por tipo de carta
      if (p.creature) p.haste ? F.haste(el) : F.zzz(el);
      if (p.planeswalker) F.gold(el); else if (p.artifact && !p.creature) F.sheen(el); else if (p.enchantment) F.sparkle(el);
    }
  }

  /** Símbolo(s) de mana da cor que a carta produz: sobe bem rápido e some. */
  function manaPop(c) {
    const cols = [...new Set(c.produced)].filter(x => 'WUBRGC'.includes(x)).slice(0, 5);
    if (!cols.length || !root.Mana) return;
    const size = 26, gap = 4, w = cols.length * size + (cols.length - 1) * gap, cw = cardW();
    const m = document.createElement('div'); m.className = 'ptmana';
    m.style.left = (c.x + cw / 2 - w / 2) + 'px'; m.style.top = (c.y + cw * RATIO / 2 - size / 2) + 'px';
    m.innerHTML = cols.map(x => root.Mana.icon(x, size)).join('');
    document.body.appendChild(m); setTimeout(() => m.remove(), 800);
  }

  // ------------------------------------------------------------------ ligação com a página
  function init(hooks) {
    H = hooks;
    H.grim.addEventListener('click', () => { if (!dragging) draw(); });
    H.end.addEventListener('click', stop);
    document.addEventListener('keydown', e => { if (e.key === 'Escape' && P) stop(); });
    document.addEventListener('pointerdown', e => {
      if (e.button != null && e.button > 0) return;
      const t = e.target; if (!t.closest) return;
      const fc = t.closest('#fan .fc');
      if (fc && !t.closest('.fx')) {
        const idx = [...H.fan.querySelectorAll('.fc')].indexOf(fc);
        e.preventDefault();
        return startDrag(e, () => { if (!P && !start()) return null; const c = P.hand[idx]; return { c, el: H.fan.querySelectorAll('.fc')[idx] }; });
      }
      const cc = t.closest('#cmdzone .cmdcard');
      if (cc) { const idx = [...H.cmd.querySelectorAll('.cmdcard')].indexOf(cc); e.preventDefault(); return startDrag(e, () => { if (!P && !start()) return null; return { c: P.cmd[idx], el: cc }; }); }
      const tc = t.closest('.ptcard:not(.ghost)');
      if (tc && P) { const c = find(+tc.dataset.pid); if (c) { e.preventDefault(); return startDrag(e, () => ({ c, el: null })); } }
    }, true);
  }

  root.Playtest = { init, reset: stop, active: () => !!P, busy: () => dragging > 0 || !!P };
})(typeof self !== 'undefined' ? self : this);
