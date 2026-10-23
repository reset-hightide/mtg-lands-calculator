/*
 * Dado de RPG (d20 "spindown" do Magic) que cruza a tela numa trajetória aleatória e ricocheteia nas bordas até parar,
 * mostrando o número sorteado. Cor sorteada entre as cinco de mana, com efeito marmorizado; no 20 aparece o
 * símbolo de Planeswalker, como nos dados reais.
 * Dice.roll(final) -> Promise<{ say(texto), close() }>, resolvido quando o dado para.
 * Respeita prefers-reduced-motion (sem movimento). Clique ou Esc fecham.
 */
(function (root) {
  'use strict';
  const PW = 'https://svgs.scryfall.io/card-symbols/PW.svg';   // símbolo de Planeswalker (Scryfall)
  const PALETTES = {
    W: { a: '#f4eed8', b: '#b8ae93', n: '#2b253a', pw: false },
    U: { a: '#4a86d1', b: '#143a73', n: '#ffffff', pw: true },
    B: { a: '#5a5561', b: '#141218', n: '#ffffff', pw: true },
    R: { a: '#e0553d', b: '#7a1c11', n: '#ffffff', pw: true },
    G: { a: '#3fa563', b: '#134d2d', n: '#ffffff', pw: true },
  };
  const rand = (a, b) => a + Math.random() * (b - a);
  let uid = 0;

  function dieSvg(p) {
    const k = ++uid;
    const seed = Math.floor(rand(1, 99));
    const edge = p.n === '#ffffff' ? '#ffffff' : '#2b253a';
    const small = [[24, 38, 13], [76, 38, 19], [88, 58, 12], [68, 86, 7], [32, 86, 16], [12, 58, 9]]
      .map(([x, y, t]) => `<text x="${x}" y="${y}" text-anchor="middle" font-size="9" font-weight="700" fill="${p.n}" opacity=".85">${t}</text>`).join('');
    return `<svg class="die-svg" viewBox="0 0 100 100" aria-hidden="true">
      <defs>
        <linearGradient id="dg${k}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${p.a}"/><stop offset="1" stop-color="${p.b}"/></linearGradient>
        <clipPath id="hc${k}"><polygon points="50,3 93,27 93,73 50,97 7,73 7,27"/></clipPath>
        <filter id="mb${k}" x="0" y="0" width="100%" height="100%"><feTurbulence type="fractalNoise" baseFrequency="0.03 0.07" numOctaves="3" seed="${seed}"/>
          <feColorMatrix type="matrix" values="0 0 0 0 1  0 0 0 0 1  0 0 0 0 1  0 0 0 1.7 -0.62"/></filter>
      </defs>
      <polygon points="50,3 93,27 93,73 50,97 7,73 7,27" fill="url(#dg${k})" stroke="${edge}" stroke-opacity=".55" stroke-width="2.5" stroke-linejoin="round"/>
      <g clip-path="url(#hc${k})"><rect width="100" height="100" filter="url(#mb${k})" opacity=".42"/></g>
      <polygon points="50,20 80,70 20,70" fill="rgba(255,255,255,.07)" stroke="${edge}" stroke-opacity=".5" stroke-width="1.6" stroke-linejoin="round"/>
      <path d="M50 3V20M50 20L93 27M50 20L7 27M80 70L93 27M80 70L93 73M80 70L50 97M20 70L7 27M20 70L7 73M20 70L50 97" stroke="${edge}" stroke-opacity=".5" stroke-width="1.6" stroke-linecap="round" fill="none"/>
      ${small}
    </svg>`;
  }

  /**
   * Um passo da física: atrito exponencial, movimento e ricochete nas bordas/cantos (inverte a componente que bateu,
   * perdendo 7% de velocidade). Muta s = { x, y, vx, vy, rot, spin } e devolve { hit, v }.
   */
  function step(s, dt, W, H, r, friction) {
    const k = Math.exp(-(friction == null ? 1.15 : friction) * dt);
    s.vx *= k; s.vy *= k;
    s.x += s.vx * dt; s.y += s.vy * dt;
    let hit = false;
    if (s.x < r)     { s.x = r;     s.vx = Math.abs(s.vx) * 0.93;  hit = true; s.spin = -s.spin; }
    if (s.x > W - r) { s.x = W - r; s.vx = -Math.abs(s.vx) * 0.93; hit = true; s.spin = -s.spin; }
    if (s.y < r)     { s.y = r;     s.vy = Math.abs(s.vy) * 0.93;  hit = true; s.spin = -s.spin; }
    if (s.y > H - r) { s.y = H - r; s.vy = -Math.abs(s.vy) * 0.93; hit = true; s.spin = -s.spin; }
    const v = Math.hypot(s.vx, s.vy);
    s.rot += s.spin * v * 0.55 * dt;
    return { hit, v };
  }

  function roll(final, sides) {
    sides = sides || 20;
    return new Promise(resolve => {
      const reduce = root.matchMedia && root.matchMedia('(prefers-reduced-motion: reduce)').matches;
      const key = 'WUBRG'[Math.floor(Math.random() * 5)], pal = PALETTES[key];
      const ov = document.createElement('div');
      ov.className = 'dice-ov'; ov.setAttribute('role', 'dialog'); ov.setAttribute('aria-label', 'Sorteando um exemplo');
      ov.style.setProperty('--dn', pal.n);
      ov.innerHTML = `<div class="die-wrap"><div class="die-body">${dieSvg(pal)}<span class="die-n">${sides}</span></div></div><p class="dice-msg">Rolando o dado…</p>`;
      document.body.appendChild(ov);
      const wrap = ov.querySelector('.die-wrap'), body = ov.querySelector('.die-body'), svg = ov.querySelector('.die-svg');
      const num = ov.querySelector('.die-n'), msg = ov.querySelector('.dice-msg');
      const show = n => {
        if (n === sides && pal.pw) num.innerHTML = `<img class="die-pw" src="${PW}" alt="20" width="46" height="46">`;   // 20 = símbolo de Planeswalker
        else num.textContent = n;
      };

      let closed = false, raf = 0;
      const close = () => { if (closed) return; closed = true; cancelAnimationFrame(raf); ov.classList.add('out'); setTimeout(() => ov.remove(), 180); root.removeEventListener('keydown', onKey); };
      const onKey = e => { if (e.key === 'Escape') close(); };
      root.addEventListener('keydown', onKey);
      ov.addEventListener('click', close);

      const D = Math.max(100, Math.min(150, Math.round(Math.min(root.innerWidth, root.innerHeight) * 0.26)));
      ov.style.setProperty('--d', D + 'px');
      const place = (x, y) => { wrap.style.transform = `translate(${x - D / 2}px, ${y - D / 2}px)`; };
      const land = () => {
        show(final); ov.classList.add('landed');
        // desliza até o centro da tela para mostrar o resultado
        wrap.style.transition = 'transform .45s cubic-bezier(.2,.8,.2,1)';
        place(root.innerWidth / 2, root.innerHeight / 2 - 20);
        svg.style.transition = 'transform .45s ease-out'; svg.style.transform = 'rotate(0deg)';
        setTimeout(() => resolve({ say: t => { msg.textContent = t; }, close }), reduce ? 0 : 460);
      };

      if (reduce) { place(root.innerWidth / 2, root.innerHeight / 2 - 20); land(); return; }

      // posição e velocidade iniciais aleatórias (qualquer direção)
      const W = () => root.innerWidth, H = () => root.innerHeight, r = D / 2;
      const ang = rand(0, Math.PI * 2), speed = rand(1100, 1700);
      const st = { x: rand(r, W() - r), y: rand(r, H() - r), vx: Math.cos(ang) * speed, vy: Math.sin(ang) * speed, rot: rand(0, 360), spin: Math.random() < 0.5 ? -1 : 1 };
      let last = performance.now(), t0 = last, lastFlip = 0;

      function frame(now) {
        if (closed) return;
        const dt = Math.min(0.034, (now - last) / 1000); last = now;
        const { hit, v } = step(st, dt, W(), H(), r);
        place(st.x, st.y); svg.style.transform = `rotate(${st.rot}deg)`;
        if (hit) { body.classList.remove('hit'); void body.offsetWidth; body.classList.add('hit'); }
        if (hit || now - lastFlip > 70) { show(1 + Math.floor(Math.random() * sides)); lastFlip = now; }
        if (v < 45 || now - t0 > 4200) { land(); return; }
        raf = requestAnimationFrame(frame);
      }
      raf = requestAnimationFrame(frame);
    });
  }
  root.Dice = { roll, step };
})(typeof self !== 'undefined' ? self : this);
