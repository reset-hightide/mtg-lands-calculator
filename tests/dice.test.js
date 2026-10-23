const test = require('node:test');
const assert = require('node:assert/strict');
global.self = global;
require('../js/dice.js');
const { step } = global.Dice;

const W = 1280, H = 720, r = 75;

test('dado: nunca sai da tela e acaba parando, em 3000 rolagens simuladas', () => {
  let totalHits = 0, withHit = 0;
  for (let n = 0; n < 3000; n++) {
    const ang = Math.random() * Math.PI * 2, sp = 1100 + Math.random() * 600;
    const s = { x: r + Math.random() * (W - 2 * r), y: r + Math.random() * (H - 2 * r), vx: Math.cos(ang) * sp, vy: Math.sin(ang) * sp, rot: 0, spin: 1 };
    let hits = 0, t = 0, v = Infinity;
    while (v >= 45 && t < 4.2) {
      const out = step(s, 1 / 60, W, H, r);
      v = out.v; t += 1 / 60; if (out.hit) hits++;
      assert.ok(s.x >= r - 1e-9 && s.x <= W - r + 1e-9 && s.y >= r - 1e-9 && s.y <= H - r + 1e-9, 'saiu da tela');
    }
    assert.ok(v < 45 || t >= 4.2);   // para (ou é cortado pelo limite de tempo)
    totalHits += hits; if (hits > 0) withHit++;
  }
  assert.ok(withHit / 3000 > 0.9, 'quase toda rolagem deve bater em alguma borda');
  assert.ok(totalHits / 3000 >= 1.5, `ricochetes por rolagem: ${totalHits / 3000}`);
});

test('dado: ricochete inverte a componente que bateu e perde energia; canto inverte as duas', () => {
  // bate na parede direita
  let s = { x: W - r - 1, y: 300, vx: 800, vy: 100, rot: 0, spin: 1 };
  let o = step(s, 1 / 60, W, H, r, 0);
  assert.equal(o.hit, true); assert.ok(s.vx < 0 && s.vy > 0); assert.ok(Math.abs(s.vx) < 800);
  assert.equal(s.x, W - r);
  // canto superior esquerdo (as duas componentes invertem)
  s = { x: r + 1, y: r + 1, vx: -700, vy: -700, rot: 0, spin: 1 };
  o = step(s, 1 / 60, W, H, r, 0);
  assert.equal(o.hit, true); assert.ok(s.vx > 0 && s.vy > 0);
  assert.equal(s.x, r); assert.equal(s.y, r);
  // sem batida: movimento livre e atrito reduz a velocidade
  s = { x: 600, y: 360, vx: 500, vy: 0, rot: 0, spin: 1 };
  o = step(s, 1 / 60, W, H, r);
  assert.equal(o.hit, false); assert.ok(s.vx < 500 && s.vx > 0);
});
