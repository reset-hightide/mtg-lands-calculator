/* Explorador da base de decks (base.html): filtros, ordenação, paginação, download. */
(async function () {
  'use strict';
  const $ = id => document.getElementById(id);
  const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const PAGE = 50;
  const NUMERIC = new Set(['total_cards', 'lands', 'cmc', 'nonmythic_mdfc', 'mythic_mdfc', 'cheap_draw', 'cheap_ramp', 'companion', 'wins', 'losses', 'n_colors', 'lands_mdfc']);
  let head = [], rows = [], view = [], sortKey = null, sortDir = 1, page = 0;

  try {
    const text = await (await fetch('data/decks.csv')).text();
    const lines = text.trim().split(/\r?\n/);
    head = lines[0].split(',');
    rows = lines.slice(1).map(l => {
      const c = l.split(','), o = {};
      head.forEach((h, i) => { o[h] = NUMERIC.has(h) ? Number(c[i]) : c[i]; });
      return o;
    });
  } catch (e) {
    $('count').textContent = 'Não consegui carregar data/decks.csv (abra o site por http/https, não por arquivo local).';
    return;
  }

  const uniq = k => [...new Set(rows.map(r => r[k]))].sort();
  uniq('format').forEach(v => $('fFormat').insertAdjacentHTML('beforeend', `<option>${esc(v)}</option>`));
  uniq('archetype').forEach(v => $('fArch').insertAdjacentHTML('beforeend', `<option>${esc(v)}</option>`));

  const mean = k => rows.reduce((a, r) => a + r[k], 0) / rows.length;
  const dates = rows.map(r => r.event_date).filter(Boolean).sort();
  $('summary').innerHTML = [
    ['Decks', rows.length.toLocaleString('pt-BR')], ['Terrenos ajustados (média)', mean('lands_mdfc').toFixed(2)], ['CMC médio', mean('cmc').toFixed(2)],
    ['Compra+aceleração barata (média)', (mean('cheap_draw') + mean('cheap_ramp')).toFixed(2)], ['Período', `${dates[0]} a ${dates[dates.length - 1]}`],
  ].map(([k, v]) => `<div><div class="muted small">${k}</div><div style="font-size:20px;font-weight:600">${v}</div></div>`).join('');

  $('thead').innerHTML = '<tr>' + head.map(h => `<th class="sort${NUMERIC.has(h) ? ' num' : ''}" data-k="${h}">${h}</th>`).join('') + '</tr>';

  function apply() {
    const t = $('fText').value.trim().toLowerCase(), f = $('fFormat').value, a = $('fArch').value, c = $('fColors').value;
    const mn = $('fMin').value === '' ? -Infinity : +$('fMin').value, mx = $('fMax').value === '' ? Infinity : +$('fMax').value;
    view = rows.filter(r => (!t || r.deck_url.toLowerCase().includes(t)) && (!f || r.format === f) && (!a || r.archetype === a) &&
      (!c || r.n_colors === +c) && r.lands_mdfc >= mn && r.lands_mdfc <= mx);
    if (sortKey) view.sort((x, y) => (x[sortKey] > y[sortKey] ? 1 : x[sortKey] < y[sortKey] ? -1 : 0) * sortDir);
    page = 0; draw();
  }

  function draw() {
    const pages = Math.max(1, Math.ceil(view.length / PAGE));
    page = Math.min(page, pages - 1);
    $('tbody').innerHTML = view.slice(page * PAGE, page * PAGE + PAGE).map(r => '<tr>' + head.map(h => {
      if (h === 'deck_url') return `<td><a href="${esc(r[h])}" target="_blank" rel="noopener">${esc(r[h].replace(/^https?:\/\/(www\.)?/, '').replace('Decklist/View/', ''))}</a></td>`;
      return `<td class="${NUMERIC.has(h) ? 'num' : ''}">${esc(r[h])}</td>`;
    }).join('') + '</tr>').join('');
    $('count').textContent = `${view.length.toLocaleString('pt-BR')} de ${rows.length.toLocaleString('pt-BR')} decks`;
    $('page').textContent = `página ${page + 1} de ${pages}`;
    $('prev').disabled = page === 0; $('next').disabled = page >= pages - 1;
  }

  ['fText', 'fFormat', 'fArch', 'fColors', 'fMin', 'fMax'].forEach(id => $(id).addEventListener('input', apply));
  $('prev').onclick = () => { page--; draw(); };
  $('next').onclick = () => { page++; draw(); };
  $('thead').addEventListener('click', e => {
    const k = e.target.dataset.k; if (!k) return;
    sortDir = sortKey === k ? -sortDir : 1; sortKey = k; apply();
  });
  $('btnFiltered').onclick = () => {
    const csv = [head.join(','), ...view.map(r => head.map(h => r[h]).join(','))].join('\n');
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    a.download = 'decks_filtrados.csv'; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  };
  apply();
})();
