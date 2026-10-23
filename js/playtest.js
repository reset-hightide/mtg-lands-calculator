/*
 * Playtest em cima do próprio site (é uma zoeira): um grimório com o verso de Magic aparece só 1/4 na borda direita.
 * Arraste uma carta da mão para qualquer lugar da página e ela fica ali, por cima das tabelas; clique no grimório para
 * comprar. Sem zonas nem barras: enquanto você joga, o texto e os números do site deixam de ser selecionáveis.
 * Clique na carta da mesa vira; arraste de volta para a mão, para o comandante ou para o grimório (metade de cima = topo,
 * de baixo = fundo). Esc encerra.
 * Efeitos (sem texto, sem emoji): a cor da carta jogada dá uma animação marcante; "destroy all" derruba a página;
 * clicar numa fetch land abre a escolha do tipo de terreno que entra no lugar dela. Tudo decidido por texto e palavras do título.
 * Playtest.init({ fan, cmd, grim, end, renderFan(cartas), context() -> { cards, hand } | null, stopped() }).
 */
(function (root) {
  'use strict';
  const rnd = n => root.crypto.getRandomValues(new Uint32Array(1))[0] % n;
  const shuffle = a => { for (let i = a.length - 1; i > 0; i--) { const j = rnd(i + 1); [a[i], a[j]] = [a[j], a[i]]; } return a; };
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const RATIO = 680 / 488;

  let H = null;                 // ganchos do app
  let P = null;                 // partida em andamento: { all, lib, hand, table, cmd, gy } (null = site normal)
  let dragging = 0, zTop = 3000, pick = null;

  /** Largura da carta da mão (a mesma da mesa). Mede a carta do leque; se ainda não existe, usa a mesma fórmula do CSS. */
  const cardW = () => { const fc = H && H.fan.querySelector('.fc'); return (fc && fc.offsetWidth) || Math.max(92, Math.min(180, root.innerWidth * 0.155)); };
  const hit = (el, x, y) => { if (!el) return false; const r = el.getBoundingClientRect(); return r.width > 0 && x >= r.left - 8 && x <= r.right + 8 && y >= r.top - 8 && y <= r.bottom + 8; };
  const face = c => c.img ? `<img src="${esc(c.img)}" alt="${esc(c.name)}" draggable="false">` : `<span class="ptn">${esc(c.name)}</span>`;
  const find = id => P && (P.all.find(c => c.id === id) || P.cmd.find(c => c.id === id));
  const FX = () => root.PtFx.fx;
  const elOf = c => document.querySelector(`.ptcard[data-pid="${c.id}"]:not(.ghost)`);

  // ------------------------------------------------------------------ partida
  function start() {
    if (P) return P;
    const ctx = H.context(); if (!ctx) return null;
    let n = 0; const all = [], cmd = [];
    for (const e of ctx.cards) for (let i = 0; i < e.qty; i++) {
      const o = e.card.oracle_text || '';
      const c = {
        id: ++n, name: e.card.name || e.name, alias: e.name, img: e.card.img, uri: e.card.uri, land: !!e.cls.isLand, produced: (e.card.produced_mana || []).slice(),
        colors: e.card.colors || [], set: e.card.set || '', cmc: e.card.cmc || 0, typeLine: e.card.type_line || '', oracle: o,
        etbTapped: /enters (?:the battlefield )?tapped/i.test(o) && !/unless|you may pay|if you control|if you don't|fewer/i.test(o),
        prof: root.PtFx ? root.PtFx.analyze(e.card) : { type: '', fetchTypes: [] }, where: 'lib', x: 0, y: 0, z: 0, tapped: false,
      };
      if (e.commander) { c.where = 'cmd'; cmd.push(c); } else all.push(c);
    }
    const lib = shuffle(all.slice()), hand = [];
    for (const name of ctx.hand || []) { const i = lib.findIndex(c => c.name === name || c.alias === name); if (i >= 0) { const c = lib.splice(i, 1)[0]; c.where = 'hand'; hand.push(c); } }   // começa com a mão que a página mostrou
    P = { all, lib, hand, table: [], cmd, gy: [], franchise: root.PtFx ? root.PtFx.deckFranchise(all.concat(cmd).map(c => c.set)) : null };
    document.body.classList.add('pt-playing'); H.end.classList.remove('hidden');
    const row = H.fan.parentElement; if (row) row.style.minHeight = row.offsetHeight + 'px';   // jogar cartas não pode encolher a linha da mão: o resto da página não sobe por cima dela
    refresh();
    return P;
  }
  function stop() {
    if (!P) return;
    closePick();
    document.querySelectorAll('.ptcard').forEach(e => e.remove());
    if (root.PtFx) root.PtFx.fx.clear();   // limpa as marcas e cancela os gags
    P = null; document.body.classList.remove('pt-playing'); H.end.classList.add('hidden');
    if (H.fan.parentElement) H.fan.parentElement.style.minHeight = '';
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
  function draw() {
    if (!start()) return;
    const c = P.lib.shift();
    if (!c) { H.grim.classList.add('empty-shake'); setTimeout(() => H.grim.classList.remove('empty-shake'), 450); return; }   // vazio: o grimório só balança
    c.where = 'hand'; P.hand.push(c); refresh(c.id);
  }

  // ------------------------------------------------------------------ cartas por cima da página
  function tableEl(c) {
    let el = elOf(c);
    if (!el) { el = document.createElement('div'); el.className = 'ptcard'; el.dataset.pid = c.id; el.title = c.name + ' (clique para virar)'; el.innerHTML = face(c); document.body.appendChild(el); }
    el.style.width = cardW() + 'px'; el.style.left = c.x + 'px'; el.style.top = c.y + 'px'; el.style.zIndex = c.z; el.classList.toggle('tapped', c.tapped);
    return el;
  }
  function detach(c) {
    const a = c.where === 'lib' ? P.lib : c.where === 'hand' ? P.hand : c.where === 'table' ? P.table : c.where === 'gy' ? P.gy : null;
    if (a && a.indexOf(c) >= 0) a.splice(a.indexOf(c), 1);
  }
  function leave(c) { detach(c); if (c.where === 'table') { const el = elOf(c); if (el) el.remove(); } }
  function toTable(c, x, y) { leave(c); c.where = 'table'; c.x = Math.max(0, Math.min(root.document.documentElement.scrollWidth - cardW(), x)); c.y = Math.max(0, y); c.z = ++zTop; P.table.push(c); tableEl(c); }
  function toHand(c) { leave(c); c.where = 'hand'; c.tapped = false; P.hand.push(c); }
  function toLib(c, bottom) { leave(c); c.where = 'lib'; c.tapped = false; bottom ? P.lib.push(c) : P.lib.unshift(c); }   // metade de cima do grimório = topo; de baixo = fundo
  function toCmd(c) { leave(c); c.where = 'cmd'; c.tapped = false; }
  /** Carta sai da mesa com animação (e vai para o cemitério invisível). */
  function exit(c, how) { const el = elOf(c); detach(c); c.where = 'gy'; if (el) FX().leave(el, how); }

  // ------------------------------------------------------------------ arrastar (mouse e toque): direto, sem clicar antes
  /** resolve() é chamado só quando o gesto vira arrasto de verdade: aí a partida começa (se ainda não começou). -> { c, el } */
  function startDrag(e, resolve) {
    const sx = e.clientX, sy = e.clientY, thr = e.pointerType === 'touch' ? 4 : 6;
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
    const gHalf = (x, y) => { if (!hit(H.grim, x, y)) return null; const r = H.grim.getBoundingClientRect(); return y < r.top + r.height / 2 ? 'top' : 'bottom'; };
    const move = ev => {
      if (!moved && Math.hypot(ev.clientX - sx, ev.clientY - sy) < thr) return;
      if (!moved) {
        const r = resolve(); if (!r || !r.c) { cleanup(); return; }
        ({ c, el } = r); moved = true; dragging++; fromTable = c.where === 'table';
        closePick();
        const w = cardW(); ox = fromTable ? sx + root.scrollX - c.x : w / 2; oy = fromTable ? sy + root.scrollY - c.y : w * RATIO / 2;
        if (!fromTable) { ghost = document.createElement('div'); ghost.className = 'ptcard ghost'; ghost.style.width = w + 'px'; ghost.innerHTML = face(c); document.body.appendChild(ghost); if (el) el.style.opacity = '.25'; }
        else c.z = ++zTop;
        document.body.classList.add('pt-drag');
        raf = requestAnimationFrame(scrollLoop);
      }
      place(ev);
      const h = gHalf(ev.clientX, ev.clientY);
      H.grim.classList.toggle('drop', !!h); H.grim.classList.toggle('drop-top', h === 'top'); H.grim.classList.toggle('drop-bottom', h === 'bottom');
    };
    const cleanup = () => { root.removeEventListener('pointermove', move); root.removeEventListener('pointerup', up); root.removeEventListener('pointercancel', up); cancelAnimationFrame(raf); };
    const up = ev => {
      cleanup(); H.grim.classList.remove('drop', 'drop-top', 'drop-bottom'); document.body.classList.remove('pt-drag');
      if (!moved) { const t = ev.target.closest && ev.target.closest('.ptcard'); if (t && P) { const k = find(+t.dataset.pid); if (k && k.where === 'table') tap(k); } return; }   // clique na carta da mesa: vira
      if (ghost) ghost.remove(); if (el) el.style.opacity = '';
      const blockClick = ck => { ck.preventDefault(); ck.stopPropagation(); root.removeEventListener('click', blockClick, true); };   // o arrasto não pode abrir link nem comprar mão
      root.addEventListener('click', blockClick, true); setTimeout(() => root.removeEventListener('click', blockClick, true), 400);   // se nenhum clique vier (toque), o bloqueio expira sozinho
      setTimeout(() => { dragging = Math.max(0, dragging - 1); }, 80);
      const x = ev.clientX, y = ev.clientY, px = x + root.scrollX - ox, py = y + root.scrollY - oy, isCmd = P.cmd.includes(c), was = c.where, half = gHalf(x, y);
      let played = false;
      if (half) { if (isCmd) { toTable(c, px, py); played = was !== 'table'; } else toLib(c, half === 'bottom'); }
      else if (isCmd && hit(H.cmd, x, y)) toCmd(c);
      else if (!isCmd && hit(H.fan, x, y)) toHand(c);
      else { toTable(c, px, py); played = was !== 'table'; }
      refresh();
      if (played) cast(c);   // jogou da mão na mesa: efeito da carta
    };
    root.addEventListener('pointermove', move); root.addEventListener('pointerup', up); root.addEventListener('pointercancel', up);
  }
  function tap(c) {   // clique vira / desvira. Fetch land: abre a escolha do terreno que entra no lugar dela.
    if (c.prof && c.prof.fetch && root.PtFx && !c.tapped) return crack(c);
    c.tapped = !c.tapped; const el = tableEl(c);
    if (c.tapped && c.prof && c.prof.tapMana) manaPop(c);
    if (c.tapped && c.land && root.PtFx) FX().land(c.name, el);   // terreno virado: efeito discreto pelo nome
  }
  /** Símbolo(s) de mana da cor que a carta produz: grande, sobe bem rápido e some. */
  function manaPop(c) {
    const cols = [...new Set(c.produced)].filter(x => 'WUBRGC'.includes(x)).slice(0, 5);
    if (!cols.length || !root.Mana) return;
    const size = 58, gap = 6, w = cols.length * size + (cols.length - 1) * gap, cw = cardW();
    const m = document.createElement('div'); m.className = 'ptmana';
    m.style.left = (c.x + cw / 2 - w / 2) + 'px'; m.style.top = (c.y + cw * RATIO / 2 - size / 2) + 'px';
    m.innerHTML = cols.map(x => root.Mana.icon(x, size)).join('');
    document.body.appendChild(m); setTimeout(() => m.remove(), 900);
  }

  // ------------------------------------------------------------------ efeitos que ficaram: destruição global e fetch land
  function closePick() { if (pick) { pick.remove(); pick = null; } }
  /** Fetch land: aparecem os símbolos dos tipos que ela busca; escolher um traz do grimório o melhor terreno daquele tipo. */
  function crack(c) {
    closePick();
    const el = elOf(c), list = c.prof.fetchTypes.length ? c.prof.fetchTypes : root.PtFx.BASICS;
    FX().shake(el);
    const cw = cardW(), size = list.length > 2 ? 52 : 66, gap = 10, w = list.length * size + (list.length - 1) * gap;
    const box = document.createElement('div'); box.className = 'ptpick'; box.style.left = (c.x + cw / 2 - w / 2) + 'px'; box.style.top = (c.y + cw * RATIO / 2 - size / 2) + 'px';
    box.innerHTML = list.map((t, i) => `<button type="button" class="ptpickbtn" data-t="${t}" style="--i:${i};width:${size}px;height:${size}px" aria-label="${t}">${root.Mana ? root.Mana.icon(root.PtFx.colorOfType(t), size - 6) : t}</button>`).join('');
    document.body.appendChild(box); pick = box;
    box.addEventListener('click', e => { const b = e.target.closest('.ptpickbtn'); if (!b) return; e.stopPropagation(); choose(c, b.dataset.t); });
  }
  function choose(c, type) {
    closePick();
    const F = FX(), x = c.x, y = c.y, el = elOf(c), re = new RegExp('\\b' + type + '\\b', 'i');
    const cands = P.lib.filter(l => l.land && re.test(l.typeLine));
    if (!cands.length) { F.shake(el); return; }   // sem terreno desse tipo no grimório
    const score = l => root.PtFx.landScore(l.typeLine, l.oracle), best = Math.max(...cands.map(score)), top = cands.filter(l => score(l) === best), chosen = top[rnd(top.length)];
    F.poof(el); exit(c, 'burnaway'); shuffle(P.lib);
    setTimeout(() => { if (!P) return; toTable(chosen, x, y); chosen.tapped = chosen.etbTapped; F.pop(tableEl(chosen)); badge(); }, 380);
  }
  /** Jogou da mão na mesa. Destruição global derruba tudo; qualquer outra carta solta a assinatura da cor (e do título). */
  function cast(c) {
    if (!root.PtFx || !P || c.land) return;
    const el = elOf(c), F = FX(); if (!el) return;
    if (c.prof && c.prof.wrath) {   // a Cólera de Deus acaba com o jogo: cratera, letras caindo, a mesa inteira vai embora
      F.quake(); F.crater(el, true); F.flash(); F.gag('gravity', el);
      P.table.filter(x => x !== c).forEach((x, i) => { if (elOf(x)) setTimeout(() => { if (P && x.where === 'table') exit(x, 'spin'); }, i * 60); });
      setTimeout(() => { if (P) F.blackout(); }, 1500);
      setTimeout(() => { if (P && c.where === 'table') exit(c, 'fade'); }, 1900);
      return;
    }
    const fr = root.PtFx.franchiseOf(c.set) || (P.franchise && root.PtFx.hash(c.name) % 5 < 2 ? P.franchise : null);   // edição de franquia (ou baralho de franquia, de vez em quando)
    F.cast(c.name, c.colors, el, c.cmc, c.typeLine, c.oracle, fr);   // custo baixo = efeito sutil; custo alto = a tela toda
  }

  // ------------------------------------------------------------------ ligação com a página
  function init(hooks) {
    H = hooks;
    H.grim.addEventListener('click', () => { if (!dragging) draw(); });
    H.end.addEventListener('click', stop);
    document.addEventListener('keydown', e => { if (e.key === 'Escape') { if (pick) closePick(); else if (P) stop(); } });
    document.addEventListener('pointerdown', e => {
      if (pick && !e.target.closest('.ptpick')) closePick();
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

  root.Playtest = { init, reset: stop, active: () => !!P, busy: () => dragging > 0 || !!P, peek: () => P && { lib: P.lib.map(c => c.name), hand: P.hand.map(c => c.name), table: P.table.map(c => c.name) } };   // peek: só leitura (testes)
})(typeof self !== 'undefined' ? self : this);
