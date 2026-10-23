/*
 * Símbolos de mana (SVGs oficiais servidos pelo Scryfall: https://scryfall.com/docs/api/card-symbols).
 * Se a imagem não carregar, o círculo colorido de fundo continua indicando a cor.
 */
(function (root) {
  'use strict';
  const BASE = 'https://svgs.scryfall.io/card-symbols/';
  const BG = { W: '#f8f2d0', U: '#6fb6f0', B: '#9a8dab', R: '#ee7b5f', G: '#6dc98a', C: '#cfc9c0' };
  const key = s => String(s).replace(/[{}\/]/g, '');          // "{W/U}" -> "WU", "{2/W}" -> "2W"

  /** HTML de um símbolo: icon('W'), icon('{W/U}'), icon('2'). */
  function icon(sym, size) {
    size = size || 16;
    const k = key(sym);
    return `<span class="mi" style="width:${size}px;height:${size}px;background:${BG[k] || '#d6d9de'}" title="${k}"><img src="${BASE}${k}.svg" alt="${k}" width="${size}" height="${size}"></span>`;
  }
  /** Custo de mana "{2}{W}{W}" como sequência de símbolos. */
  function cost(str, size) {
    return [...String(str || '').matchAll(/\{([^}]+)\}/g)].map(m => icon(m[1], size || 14)).join('');
  }

  const api = { icon, cost, BG };
  root.Mana = api;
  // troca as bolinhas do logo por símbolos reais
  if (typeof document !== 'undefined') {
    const swap = () => document.querySelectorAll('.pips').forEach(p => { p.innerHTML = ['W', 'U', 'B', 'R', 'G'].map(c => icon(c, 16)).join(''); p.classList.add('real'); });
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', swap); else swap();
  }
})(typeof self !== 'undefined' ? self : this);
