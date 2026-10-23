/* Interface da calculadora (index.html): colar lista (automático) ou planilha Excel (vários decks). */
(function () {
  'use strict';
  const $ = id => document.getElementById(id);
  const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const f2 = x => x.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const f1 = x => x.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  const num = x => (Math.abs(x - Math.round(x)) < 1e-9 ? String(Math.round(x)) : f1(x));
  const COLOR_NAMES = { W: 'Branco', U: 'Azul', B: 'Preto', R: 'Vermelho', G: 'Verde' };
  const frontCost = c => (c.card_faces && c.card_faces[0] ? c.card_faces[0].mana_cost : c.mana_cost) || '';
  const chipHtml = c => `${Mana.icon(c, 16)}${COLOR_NAMES[c]}`;

  // mode 'paste': um deck, opções na bancada; mode 'excel': vários decks, ajustes por deck
  const state = { decks: [], results: [], busy: false, mode: 'paste', colorsManual: '', lastText: null, timer: null };

  function status(msg, err, busy) { const s = $('status'); s.textContent = msg; s.className = 'status' + (err ? ' err' : '') + (busy ? ' busy' : ''); }

  // ------------------------------------------------------------------ download
  function download(bytes, name) {
    const url = URL.createObjectURL(new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
    const a = document.createElement('a'); a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }
  $('btnTemplate').onclick = () => download(Template.buildTemplate(), 'Calculadora_Terrenos_Template.xlsx');
  $('btnDownload').onclick = () => download(Template.buildResults(state.results), 'Resultado_Terrenos.xlsx');

  // ------------------------------------------------------------------ opções da bancada (modo colar lista)
  document.querySelectorAll('#optColors .chip[data-c]').forEach(c => { c.innerHTML = chipHtml(c.dataset.c); });
  const pasteParams = () => ({ archetype: $('optArch').value, size: $('optSize').value, companion: $('optComp').value, colors: state.colorsManual });

  /** Mostra o que foi detectado nos próprios campos ("Auto (60)") e destaca as cores. */
  function syncOptions() {
    const box = $('detect');
    if (state.mode !== 'paste' || !state.results[0] || !state.results[0].ok) { box.classList.add('hidden'); return; }
    const r = state.results[0];
    // o que o modo Auto decidiria, independente do que o usuário escolheu manualmente
    const a = Pipeline.evaluateDeck({ ...state.decks[0], params: {} }, Scryfall.get);
    const setAuto = (id, label) => { const o = $(id).querySelector('option[value="Auto"]'); o.textContent = label; };
    setAuto('optSize', `Auto (${a.size} cartas)`);
    setAuto('optArch', `Auto (${a.archetype})`);
    setAuto('optComp', `Auto (${a.companion ? 'Sim' : 'Não'})`);
    document.querySelectorAll('#optColors .chip[data-c]').forEach(c => c.classList.toggle('on', r.colorsList.includes(c.dataset.c)));
    $('chipAuto').classList.toggle('on', state.colorsManual === '');
    const cores = r.colorsList ? r.colorsList.split('').map(c => `${Mana.icon(c, 15)} ${COLOR_NAMES[c]}`).join(' ') : 'nenhuma';
    box.innerHTML = `<b>Detectado:</b> ${r.size} cartas (${esc(r.sizeSource)}) · arquétipo <b>${esc(r.archetype)}</b> (${esc(r.archetypeSource)}) · cores <b>${cores}</b> (${esc(r.colorsSource)}) · companion <b>${r.companion ? 'sim' : 'não'}</b>`;
    box.classList.remove('hidden');
  }

  // ------------------------------------------------------------------ entrada: colar lista
  async function analyzePaste() {
    const text = $('deckText').value;
    if (!text.trim()) return status('Cole a lista do deck acima.', true);
    const d = Pipeline.deckFromText(text, $('deckName').value.trim() || 'Meu deck', pasteParams());
    if (!d.main.size) return status('Não encontrei cartas. Use linhas como “4 Lightning Bolt” ou cole o export do Archidekt.', true);
    state.lastText = text + '\u0000' + $('deckName').value;
    await run([d], [], 'paste');
  }

  /** Opção mudou: se o texto é o mesmo, recalcula na hora (sem rede); senão analisa de novo. */
  function optionChanged() {
    const sig = $('deckText').value + '\u0000' + $('deckName').value;
    if (state.mode === 'paste' && state.decks.length && state.lastText === sig) {
      state.decks[0].params = pasteParams();
      recalc();
    } else if ($('deckText').value.trim()) {
      analyzePaste();
    }
  }
  ['optSize', 'optArch', 'optComp'].forEach(id => $(id).addEventListener('change', optionChanged));
  $('deckName').addEventListener('change', optionChanged);
  $('optColors').addEventListener('click', e => {
    const t = e.target.closest('.chip'); if (!t) return;
    if (t.id === 'chipAuto') state.colorsManual = '';
    else {
      const r = state.results[0];
      const set = new Set(state.colorsManual ? (state.colorsManual === 'nenhuma' ? [] : state.colorsManual.split('')) : (r && r.ok ? r.colorsList.split('') : []));
      set.has(t.dataset.c) ? set.delete(t.dataset.c) : set.add(t.dataset.c);
      state.colorsManual = 'WUBRG'.split('').filter(c => set.has(c)).join('') || 'nenhuma';
    }
    document.querySelectorAll('#optColors .chip[data-c]').forEach(c => { if (state.colorsManual && state.colorsManual !== 'nenhuma') c.classList.toggle('on', state.colorsManual.includes(c.dataset.c)); });
    $('chipAuto').classList.toggle('on', state.colorsManual === '');
    optionChanged();
  });
  $('btnPaste').onclick = analyzePaste;
  // colou a lista: calcula sozinho
  $('deckText').addEventListener('paste', () => { clearTimeout(state.timer); state.timer = setTimeout(analyzePaste, 80); });
  $('deckText').addEventListener('keydown', e => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) analyzePaste(); });
  $('btnClear').onclick = () => {
    $('deckText').value = ''; $('deckName').value = ''; state.colorsManual = ''; state.lastText = null; state.decks = []; state.results = [];
    $('results').classList.add('hidden'); $('detect').classList.add('hidden');
    document.querySelectorAll('#optColors .chip[data-c]').forEach(c => c.classList.remove('on')); $('chipAuto').classList.add('on');
    status('O resultado aparece sozinho quando você cola a lista.'); $('deckText').focus();
  };
  $('btnSample').onclick = () => {
    $('deckName').value = 'Izzet Tempo';
    $('deckText').value = `4x Delver of Secrets // Insectile Aberration (isd) 51 [Threat]
4x Brazen Borrower // Petty Theft (eld) 39 [Threat]
4x Counterspell (mh2) 267 [Counter]
4x Lightning Bolt (m10) 146 [Burn]
4x Brainstorm (mmq) 61 [Draw]
4x Murktide Regent (mh2) 52 [Threat]
4x Dragon's Rage Channeler (mh2) 120 [Threat]
2x Force of Will (all) 28 [Counter]
4x Expressive Iteration (stx) 183 [Draw]
2x Fire // Ice (mh2) 290 [Burn]
8x Island (ana) 63 [Land]
6x Mountain (ana) 65 [Land]
4x Steam Vents (grn) 257 [Land]
4x Spirebluff Canal (kld) 245 [Land]
2x Scalding Tarn (mh2) 240 [Land]
1x Shock (m21) 159 [Maybeboard{noDeck}{noPrice}]
2x Negate (m20) 54 [Sideboard]`;
    analyzePaste();
  };

  // ------------------------------------------------------------------ entrada: planilha
  async function handleFile(file) {
    if (!file) return;
    if (file.size > 15 * 1024 * 1024) return status('Arquivo grande demais (máx. 15 MB).', true);
    try {
      status('Lendo a planilha…', false, true);
      let sheets;
      if (/\.csv$/i.test(file.name)) sheets = { Cartas: XlsxLite.parseCsv(await file.text()) };
      else if (/\.xlsx$/i.test(file.name)) sheets = await XlsxLite.readXlsx(await file.arrayBuffer());
      else return status('Envie um arquivo .xlsx ou .csv.', true);
      const { decks, warnings } = Pipeline.decksFromSheets(sheets);
      await run(decks, warnings, 'excel');
    } catch (e) { status(e.message || String(e), true); }
  }
  $('file').addEventListener('change', e => { handleFile(e.target.files[0]); e.target.value = ''; });
  const drop = $('drop');
  ['dragenter', 'dragover'].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.add('over'); }));
  ['dragleave', 'drop'].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.remove('over'); }));
  drop.addEventListener('drop', e => handleFile(e.dataTransfer.files[0]));

  // ------------------------------------------------------------------ execução
  async function run(decks, warnings, mode) {
    if (state.busy) return;
    state.busy = true;
    try {
      status('Buscando cartas no Scryfall…', false, true);
      await Scryfall.fetchCards(Pipeline.allNames(decks), { onProgress: (a, b) => status(`Buscando cartas no Scryfall… ${a}/${b}`, false, true) });
      state.decks = decks; state.mode = mode;
      recalc();
      const g = $('globalWarnings'); g.textContent = warnings.join(' '); g.classList.toggle('hidden', !warnings.length);
      $('results').classList.remove('hidden');
      status(mode === 'paste' ? 'Pronto. Mudou algo nas opções? O resultado atualiza sozinho.' : `${decks.length} deck(s) analisado(s).`);
      $('results').scrollIntoView({ behavior: 'smooth', block: 'start' });
    } catch (e) {
      status('Não consegui consultar o Scryfall: ' + (e.message || e) + ' Verifique sua conexão e tente de novo.', true);
    } finally { state.busy = false; }
  }

  function recalc() {
    state.results = state.decks.map(d => Pipeline.evaluateDeck(d, Scryfall.get));
    render();
    syncOptions();
  }

  // ------------------------------------------------------------------ renderização
  function sourceCard(x) {
    const pct = x.needed ? Math.min(100, Math.round(100 * x.current / x.needed)) : 100;
    const faixa = x.tableRange ? (x.tableRange[0] === x.tableRange[1] ? `${x.tableRange[0]}` : `${x.tableRange[0]}–${x.tableRange[1]}`) : null;
    const falta = x.needed - x.current;
    const st = x.current >= x.needed - 1e-9 ? '<span class="pos">suficiente</span>' : `<span class="neg">faltam ≈ ${num(falta)}</span>`;
    const notes = [`Fórmula: ${x.byFormula} (${Math.round(x.share * 100)}% dos pips)`];
    if (faixa) notes.push(`Tabela de ${x.multiPip >= 4 ? '4+' : x.multiPip} pips: ${faixa}`);
    if (x.rampCredit) notes.push(`Ramp: −${f1(x.rampCredit)} → terrenos devem dar ${x.fromLands}`);
    return `<div class="src c${x.color}">
      <div class="srchead">${Mana.icon(x.color, 30)}<b>${COLOR_NAMES[x.color]}</b><span class="muted small">${num(x.pips)} pips</span></div>
      <div class="srcnum"><span class="n2">${x.needed}</span><span>fontes necessárias</span></div>
      <div class="bar2"><i style="width:${pct}%"></i></div>
      <p class="barlbl">Nos seus terrenos hoje: <b>${num(x.current)}</b> · ${st}</p>
      <ul class="srcnotes">${notes.map(n => `<li>${n}</li>`).join('')}</ul>
    </div>`;
  }

  const summaryText = r => `${r.name}: ≈ ${r.rounded} terrenos (${f2(r.lands)}) · ` + r.sources.rows.map(x => `${COLOR_NAMES[x.color]} ${x.needed} fontes`).join(' · ');

  function deckHtml(r, i) {
    if (!r.ok) return `<article class="deck"><h3>${esc(r.name)}</h3><p class="neg">${esc(r.error)}</p>${r.missing && r.missing.length ? `<p class="muted small">Não encontradas: ${esc(r.missing.join(', '))}</p>` : ''}</article>`;
    const d = state.decks[i], p = d.params;
    const cmp = Math.abs(r.delta) < 0.5 ? 'alinhado com o modelo' : r.delta > 0 ? `faltam ≈ ${f1(r.delta)}` : `sobram ≈ ${f1(-r.delta)}`;
    const sel = (key, opts, cur) => `<select data-i="${i}" data-k="${key}">${opts.map(([v, t]) => `<option value="${v}"${String(cur) === String(v) ? ' selected' : ''}>${t}</option>`).join('')}</select>`;
    const auto = v => (v === '' || v == null || /^auto/i.test(String(v)));
    const archCur = auto(p.archetype) ? 'Auto' : r.archetype;
    const sizeCur = auto(p.size) ? 'Auto' : r.size;
    const compCur = auto(p.companion) ? 'Auto' : (r.companion ? 'Sim' : 'Não');
    const chips = 'WUBRG'.split('').map(c => `<span class="chip${r.colorsList.includes(c) ? ' on' : ''}" data-c="${c}" data-i="${i}" title="${COLOR_NAMES[c]}">${chipHtml(c)}</span>`).join('');
    const pipsBadge = r.colorsList ? r.colorsList.split('').map(c => Mana.icon(c, 16)).join('') : '<span class="muted">sem cor</span>';
    const flagged = r.cards.filter(c => c.cls.draw || c.cls.ramp || c.cls.mdfc).sort((a, b) => a.name.localeCompare(b.name));
    const excluded = d.excluded || new Set();
    const rows = flagged.map(c => `<tr><td>${c.qty}</td><td>${esc(c.name)}</td><td class="cost">${Mana.cost(frontCost(c.card), 15)}</td><td>${c.cls.draw ? '<span class="tag draw">compra barata</span>' : ''}${c.cls.ramp ? '<span class="tag ramp">aceleração barata</span>' : ''}${c.cls.mdfc ? `<span class="tag mdfc">MDFC ${c.cls.mdfc === 'mythic' ? 'mítico (0,74)' : '(0,38)'}</span>` : ''}</td><td>${c.cls.draw || c.cls.ramp ? `<input type="checkbox" checked data-i="${i}" data-x="${esc(c.name)}">` : ''}</td></tr>`).join('');
    const exRows = [...excluded].map(n => `<tr><td></td><td>${esc(n)}</td><td></td><td><span class="muted">fora da contagem</span></td><td><input type="checkbox" data-i="${i}" data-x="${esc(n)}"></td></tr>`).join('');
    const warn = r.warnings.length ? `<p class="warn">${r.warnings.map(esc).join('<br>')}</p>` : '';
    const adjust = state.mode === 'excel' ? `
      <details class="adjust"><summary>Ajustar arquétipo, tamanho, companion ou cores deste deck</summary>
        <div class="grid">
          <div><label>Arquétipo <span class="muted">(${esc(r.archetypeSource)})</span></label>${sel('archetype', [['Auto', 'Auto'], ...Rules.ARCHETYPES.map(a => [a, a])], archCur)}</div>
          <div><label>Tamanho <span class="muted">(${esc(r.sizeSource)})</span></label>${sel('size', [['Auto', 'Auto'], [40, '40 cartas'], [60, '60 cartas'], [100, '100 cartas']], sizeCur)}</div>
          <div><label>Companion <span class="muted">(${esc(r.companionSource)})</span></label>${sel('companion', [['Auto', 'Auto'], ['Sim', 'Sim'], ['Não', 'Não']], compCur)}</div>
          <div><label>Cores <span class="muted">(${esc(r.colorsSource)})</span></label><div class="chips">${chips}<span class="chip" data-i="${i}" data-auto="1">Auto</span></div></div>
        </div>
      </details>` : '';
    const verdict = `<div class="verdict"><div class="vt">Use <b>≈ ${r.rounded} terrenos</b> · ${r.sources.rows.map(x => `${Mana.icon(x.color, 22)}<b>${x.needed}</b> fontes de ${COLOR_NAMES[x.color].toLowerCase()}`).join(' · ')}</div>
      <button class="ghost small copybtn" type="button" data-i="${i}">Copiar resumo</button></div>`;
    return `<article class="deck">
      <div class="deckhead"><h3>${esc(r.name)}</h3>
        <div class="meta">
          <span class="badge"><b>${r.mainTotal}</b> cartas</span>
          <span class="badge">Arquétipo <b>${esc(r.archetype)}</b></span>
          <span class="badge">Cores ${pipsBadge}</span>
          <span class="badge">${r.pureLands} terrenos + ${f2(r.currentLands - r.pureLands)} de MDFC</span>
        </div></div>
      ${verdict}
      <div class="kpis">
        <div class="kpi main"><span class="k">Terrenos recomendados</span><span class="v">${f2(r.lands)}</span><span class="s">≈ ${r.rounded} · faixa típica ${f1(r.low)} a ${f1(r.high)}</span></div>
        <div class="kpi"><span class="k">Seu deck hoje</span><span class="v">${f2(r.currentLands)}</span><span class="s">${cmp}</span></div>
        <div class="kpi"><span class="k">Karsten (referência)</span><span class="v">${f2(r.karsten)}</span><span class="s">modelo anterior</span></div>
        <div class="kpi"><span class="k">CMC · compra · ramp</span><span class="v">${f2(r.cmc)}</span><span class="s">${r.draw} compra · ${r.ramp} aceleração</span></div>
      </div>
      ${warn}
      <h4>Fontes de mana por cor <span class="muted small">(para ${r.sources.lands} terrenos)</span></h4>
      <div class="srcgrid">${r.sources.rows.map(sourceCard).join('')}</div>
      <p class="muted small" style="margin-top:8px">Fontes = (pips da cor ÷ total de pips) × terrenos, arredondado para cima; pips múltiplos (CC, CCC…) seguem a tabela; criaturas valem 1/3 de fonte e artefatos 2/3. Fetch lands não entram em “hoje”.</p>
      ${adjust}
      <details><summary>Cartas que entram na conta (desmarque para tirar da contagem)</summary>
        <table><thead><tr><th>Qtd</th><th>Carta</th><th>Custo</th><th>Classificação</th><th>Conta?</th></tr></thead><tbody>${rows}${exRows}</tbody></table>
      </details>
      <details><summary>Ver a conta</summary><pre>${esc(explain(r))}</pre></details>
    </article>`;
  }

  function explain(r) {
    const M = Rules.MODEL, a = r.archetype, c = r.inputs.colors, k = r.size / 60, pr = Rules.predict(r.inputs);
    return `Z = ${M.companion}·companion + ${M.colors}·cores + δ(${a}) + γ(${a})·cores
  = ${(M.companion * (r.companion ? 1 : 0)).toFixed(4)} + ${(M.colors * c).toFixed(4)} + ${M.arch[a].toFixed(4)} + ${(M.inter[a] * c).toFixed(4)} = ${pr.z.toFixed(4)}

base = ${M.b0} + ${M.cmc}·${r.cmc.toFixed(4)} + Z = ${pr.base.toFixed(4)}

terrenos = (${r.size}/60)·base − ${-M.draw}·${r.draw} − ${-M.ramp}·${r.ramp}
         = ${k.toFixed(4)}·${pr.base.toFixed(4)} − ${(-M.draw * r.draw).toFixed(4)} − ${(-M.ramp * r.ramp).toFixed(4)} = ${pr.lands.toFixed(4)}`;
  }

  function render() {
    const open = new Set([...document.querySelectorAll('#decks details[open]')].map(d => d.querySelector('summary').textContent));   // mantém "Cartas"/"Ver a conta" abertos
    $('decks').innerHTML = state.results.map(deckHtml).join('');
    document.querySelectorAll('#decks details').forEach(d => { if (open.has(d.querySelector('summary').textContent)) d.open = true; });
  }

  // ------------------------------------------------------------------ ajustes por deck (modo Excel) e copiar resumo
  $('decks').addEventListener('change', e => {
    const t = e.target, i = +t.dataset.i;
    if (Number.isNaN(i) || !state.decks[i]) return;
    const d = state.decks[i];
    if (t.dataset.k) { d.params[t.dataset.k] = t.value; recalc(); }
    else if (t.dataset.x !== undefined) {
      d.excluded = d.excluded || new Set();
      if (t.checked) d.excluded.delete(t.dataset.x); else d.excluded.add(t.dataset.x);
      recalc();
    }
  });
  $('decks').addEventListener('click', e => {
    const cb = e.target.closest('.copybtn');
    if (cb) {
      const r = state.results[+cb.dataset.i];
      navigator.clipboard.writeText(summaryText(r)).then(() => { cb.textContent = 'Copiado ✓'; setTimeout(() => { cb.textContent = 'Copiar resumo'; }, 1800); }).catch(() => { cb.textContent = 'Não consegui copiar'; });
      return;
    }
    const t = e.target.closest('.chip'); if (!t) return;
    const i = +t.dataset.i, d = state.decks[i], r = state.results[i];
    if (t.dataset.auto) { d.params.colors = ''; return recalc(); }
    const set = new Set(r.colorsList.split(''));
    set.has(t.dataset.c) ? set.delete(t.dataset.c) : set.add(t.dataset.c);
    d.params.colors = 'WUBRG'.split('').filter(c => set.has(c)).join('') || 'nenhuma';
    recalc();
  });
})();
