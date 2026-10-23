/*
 * Roda da Fortuna: a roda da arte (img/cena.webp) gira sobre o site, desacelera e para num dos quatro símbolos.
 * A cena é recortada da própria imagem: o disco da roda vira uma camada separada que gira por cima do fundo.
 * Wheel.spin() -> Promise<{ symbol, say(texto), close(), cancelled? }>, resolvido quando a roda para.
 * Respeita prefers-reduced-motion. Esc fecha. Se a imagem não carregar, sorteia sem animação.
 */
(function (root) {
  'use strict';
  // símbolo e ângulo (sentido horário a partir do topo) de cada um na arte
  const SYMBOLS = [
    { name: 'Caveira', angle: 253.2 },
    { name: 'Espada', angle: 157.1 },
    { name: 'Coração', angle: 63.2 },
    { name: 'Taça', angle: 336.9 },
  ];
  // centro e raio da roda na imagem original (582 x 467), medidos sobre a borda da madeira
  const CX = 380, CY = 204, R = 150, SCALE = 1.04, FEATHER = 1.5;
  const IMAGE_URL = 'img/cena.webp';
  const SPIN_MS = 2000;   // 2 segundos, com muitas voltas: gira bem rápido

  const randomIndex = n => root.crypto.getRandomValues(new Uint32Array(1))[0] % n;

  /** Novo ângulo acumulado para que o símbolo `sym` pare sob o ponteiro (topo), com `jitter` graus de folga. */
  function plan(sym, current, jitter, turns) {
    const finalMod = (((-sym.angle + jitter) % 360) + 360) % 360;
    const curMod = ((current % 360) + 360) % 360;
    const delta = (((finalMod - curMod) % 360) + 360) % 360;
    return current + turns * 360 + delta;
  }

  const load = src => new Promise((resolve, reject) => { const i = new Image(); i.onload = () => resolve(i); i.onerror = reject; i.src = src; });

  let prepared = null;   // cena (sem o disco) e disco, prontos para reuso
  async function prepare() {
    if (prepared) return prepared;
    const img = await load(IMAGE_URL);
    const W = img.naturalWidth, H = img.naturalHeight;
    const src = document.createElement('canvas'); src.width = W; src.height = H;
    const sctx = src.getContext('2d'); sctx.drawImage(img, 0, 0);
    const px = sctx.getImageData(0, 0, W, H).data;

    // cor média da madeira dentro do disco (ignora sombras escuras e símbolos)
    let n = 0, sr = 0, sg = 0, sb = 0;
    for (let y = CY - R; y < CY + R; y++) for (let x = CX - R; x < CX + R; x++) {
      if (Math.hypot(x - CX, y - CY) > R - 8) continue;
      const i = (y * W + x) * 4;
      if (px[i] > 120 && px[i] - px[i + 2] > 30) { sr += px[i]; sg += px[i + 1]; sb += px[i + 2]; n++; }
    }
    const wood = `rgb(${Math.round(sr / n)}, ${Math.round(sg / n)}, ${Math.round(sb / n)})`;

    // cena: o disco original é coberto por madeira lisa, para não aparecer sob a roda girando
    const scene = document.createElement('canvas'); scene.width = W; scene.height = H;
    const cctx = scene.getContext('2d'); cctx.drawImage(img, 0, 0);
    cctx.beginPath(); cctx.arc(CX, CY, R + 1, 0, Math.PI * 2); cctx.fillStyle = wood; cctx.fill();

    // disco: quadrado ao redor da roda, com borda circular suavizada
    const side = Math.ceil(R * 2) + 4, ox = CX - side / 2, oy = CY - side / 2;
    const dc = document.createElement('canvas'); dc.width = side; dc.height = side;
    const dctx = dc.getContext('2d'), disc = dctx.createImageData(side, side);
    for (let y = 0; y < side; y++) for (let x = 0; x < side; x++) {
      const sx = Math.round(ox + x), sy = Math.round(oy + y);
      const d = Math.hypot(sx + 0.5 - CX, sy + 0.5 - CY);
      const a = Math.max(0, Math.min(1, (R + FEATHER - d) / (2 * FEATHER)));
      if (a <= 0) continue;
      const si = (sy * W + sx) * 4, di = (y * side + x) * 4;
      disc.data[di] = px[si]; disc.data[di + 1] = px[si + 1]; disc.data[di + 2] = px[si + 2]; disc.data[di + 3] = a * 255;
    }
    dctx.putImageData(disc, 0, 0);
    prepared = { W, H, side, ox, oy, sceneURL: scene.toDataURL('image/png'), discURL: dc.toDataURL('image/png') };
    return prepared;
  }

  function overlay(innerHtml) {
    const ov = document.createElement('div');
    ov.className = 'wheel-ov'; ov.setAttribute('role', 'dialog'); ov.setAttribute('aria-label', 'Roda da Fortuna');
    ov.innerHTML = innerHtml;
    document.body.appendChild(ov);
    return ov;
  }

  function spin() {
    return new Promise(async resolve => {
      const reduce = root.matchMedia && root.matchMedia('(prefers-reduced-motion: reduce)').matches;
      const target = SYMBOLS[randomIndex(SYMBOLS.length)];
      let ov, closed = false, finished = false, done = () => {};
      const close = () => { if (closed) return; closed = true; ov && ov.classList.add('out'); setTimeout(() => ov && ov.remove(), 200); root.removeEventListener('keydown', onKey); if (!finished) resolve({ cancelled: true, close }); };
      const onKey = e => { if (e.key === 'Escape') close(); };
      root.addEventListener('keydown', onKey);

      let msg;   // elemento da mensagem (definido quando o overlay é criado)
      const say = t => { if (msg) { msg.textContent = t; msg.classList.add('result'); } };

      let P;
      try { P = await prepare(); } catch (e) { P = null; }

      if (!P) {   // sem a imagem: sorteia sem animação
        ov = overlay('<div class="wheel-box"><p class="wheel-msg">Girando a Roda da Fortuna…</p></div>');
        ov.addEventListener('click', close);
        msg = ov.querySelector('.wheel-msg');
        await new Promise(r => setTimeout(r, reduce ? 0 : 900));
        if (closed) return;
        finished = true;
        return resolve({ symbol: target.name, say, close });
      }

      const { W, H, side, ox, oy } = P;
      const pct = (a, b) => `${(a / b) * 100}%`;
      ov = overlay(`<div class="wheel-box">
        <div class="wheel-stage" style="aspect-ratio:${W} / ${H}">
          <img class="w-scene" src="${P.sceneURL}" alt="">
          <img class="w-disc" src="${P.discURL}" alt="Roda da Fortuna" style="left:${pct(ox, W)};top:${pct(oy, H)};width:${pct(side, W)};height:${pct(side, H)};transform:scale(${SCALE})">
          <div class="w-pointer" style="left:${pct(CX, W)};top:${pct(CY - R * SCALE, H)}"></div>
        </div>
        <p class="wheel-msg">Girando a Roda da Fortuna…</p><p class="wheel-hint">clique para pular</p></div>`);
      const jitter = (Math.random() * 2 - 1) * 8;
      const angle = plan(target, 0, jitter, 9 + randomIndex(3));
      const disc = ov.querySelector('.w-disc'); msg = ov.querySelector('.wheel-msg');
      // clicar: se já terminou, fecha; se ainda está girando, pula direto para o resultado
      ov.addEventListener('click', () => { if (finished) return close(); disc.style.transition = 'none'; disc.style.transform = `rotate(${angle}deg) scale(${SCALE})`; done(); });

      done = () => {
        if (finished || closed) return;
        finished = true; clearTimeout(fallback); disc.removeEventListener('transitionend', done);
        resolve({ symbol: target.name, say, close });
      };
      const fallback = setTimeout(done, (reduce ? 120 : SPIN_MS + 200));
      disc.addEventListener('transitionend', done);
      disc.style.transition = reduce ? 'none' : `transform ${SPIN_MS}ms cubic-bezier(0.17, 0.67, 0.2, 1)`;
      requestAnimationFrame(() => requestAnimationFrame(() => { disc.style.transform = `rotate(${angle}deg) scale(${SCALE})`; }));
    });
  }

  root.Wheel = { spin, plan, SYMBOLS };
})(typeof self !== 'undefined' ? self : this);
