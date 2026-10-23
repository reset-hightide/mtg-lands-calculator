/* Interface da calculadora (index.html): colar lista (automático) ou planilha Excel (vários decks). */
(function () {
  'use strict';
  const $ = id => document.getElementById(id);
  const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const f2 = x => x.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const f1 = x => x.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  const num = x => (Math.abs(x - Math.round(x)) < 1e-9 ? String(Math.round(x)) : f1(x));
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const COLOR_NAMES = { W: 'Branco', U: 'Azul', B: 'Preto', R: 'Vermelho', G: 'Verde' };
  const frontCost = c => (c.card_faces && c.card_faces[0] ? c.card_faces[0].mana_cost : c.mana_cost) || '';
  const chipHtml = c => `${Mana.icon(c, 16)}${COLOR_NAMES[c]}`;

  // mode 'paste': um deck, opções nos Ajustes; mode 'excel': vários decks, ajustes por deck
  const state = { decks: [], results: [], busy: false, mode: 'paste', colorsManual: '', lastText: null, timer: null, rolling: false, lastExample: -1, hands: [], handKey: '' };

  function status(msg, err, busy) { const s = $('status'); s.textContent = msg; s.className = 'status' + (err ? ' err' : '') + (busy ? ' busy' : ''); }

  // ------------------------------------------------------------------ download
  function download(bytes, name) {
    const url = URL.createObjectURL(new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
    const a = document.createElement('a'); a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }
  $('btnTemplate').onclick = () => download(Template.buildTemplate(), 'Calculadora_Terrenos_Template.xlsx');
  $('btnDownload').onclick = () => download(Template.buildResults(state.results), 'Resultado_Terrenos.xlsx');

  // ------------------------------------------------------------------ ajustes (modo colar lista)
  document.querySelectorAll('#optColors .chip[data-c]').forEach(c => { c.innerHTML = chipHtml(c.dataset.c); });
  const pasteParams = () => ({ archetype: $('optArch').value, size: $('optSize').value, companion: $('optComp').value, colors: state.colorsManual });

  /** Mostra o que foi detectado nos próprios campos ("Auto (60)") e destaca as cores. */
  function syncOptions() {
    const box = $('detect');
    if (state.mode !== 'paste' || !state.results[0] || !state.results[0].ok) { box.classList.add('hidden'); return; }
    const r = state.results[0];
    const a = Pipeline.evaluateDeck({ ...state.decks[0], params: {} }, Scryfall.get);   // o que o Auto decidiria
    const setAuto = (id, label) => { $(id).querySelector('option[value="Auto"]').textContent = label; };
    setAuto('optSize', `Auto (${a.size} cartas)`);
    setAuto('optArch', `Auto (${a.archetype})`);
    setAuto('optComp', `Auto (${a.companion ? 'Sim' : 'Não'})`);
    document.querySelectorAll('#optColors .chip[data-c]').forEach(c => c.classList.toggle('on', r.colorsList.includes(c.dataset.c)));
    $('chipAuto').classList.toggle('on', state.colorsManual === '');
    const cores = r.colorsList ? r.colorsList.split('').map(c => `${Mana.icon(c, 15)} ${COLOR_NAMES[c]}`).join(' ') : 'nenhuma';
    box.innerHTML = `<b>Detectado:</b> ${r.size} cartas (${esc(r.sizeSource)}) · arquétipo <b>${esc(r.archetype)}</b> (${esc(r.archetypeSource)}) · cores <b>${cores}</b> (${esc(r.colorsSource)}) · companion <b>${r.companion ? 'sim' : 'não'}</b>`;
    box.classList.remove('hidden');
    $('detectBrief').textContent = `(${r.size} cartas · ${r.archetype} · ${r.colorsList || 'sem cor'} — automático)`;
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
    if (state.mode === 'paste' && state.decks.length && state.lastText === sig) { state.decks[0].params = pasteParams(); recalc(); }
    else if ($('deckText').value.trim()) analyzePaste();
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
  $('deckText').addEventListener('paste', () => { clearTimeout(state.timer); state.timer = setTimeout(analyzePaste, 80); });   // colou: calcula sozinho
  $('deckText').addEventListener('keydown', e => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) analyzePaste(); });
  $('btnClear').onclick = () => {
    $('deckText').value = ''; $('deckName').value = ''; state.colorsManual = ''; state.lastText = null; state.decks = []; state.results = [];
    $('results').classList.add('hidden'); $('decks').innerHTML = ''; $('detect').classList.add('hidden'); $('detectBrief').textContent = '(tudo automático — só abra se quiser corrigir)';
    document.querySelectorAll('#optColors .chip[data-c]').forEach(c => c.classList.remove('on')); $('chipAuto').classList.add('on');
    status('O resultado aparece sozinho quando você cola a lista.'); $('deckText').focus(); $('cardstage').classList.add('hidden');
  };

  // ------------------------------------------------------------------ sortear exemplo: a Roda da Fortuna gira e o símbolo escolhe o deck
  $('btnSample').onclick = async () => {
    if (state.rolling || state.busy) return;
    state.rolling = true;
    try {
      const wheel = await Wheel.spin();
      if (wheel.cancelled) return;
      // vários decks por símbolo: sorteia entre eles, evitando repetir o último
      let pool = EXAMPLES.map((e, i) => i).filter(i => EXAMPLES[i].wheel === wheel.symbol);
      if (pool.length > 1) pool = pool.filter(i => i !== state.lastExample);
      const idx = pool[Math.floor(Math.random() * pool.length)];
      state.lastExample = idx;
      const ex = EXAMPLES[idx];
      wheel.say(ex.name);   // só o nome do deck sorteado
      await Scryfall.fetchCards(ex.cards.map(c => c[1])).catch(() => {});   // busca set/coleção das cartas
      await sleep(900);
      wheel.close();
      $('deckName').value = ex.name;
      $('deckText').value = ExamplesText(ex, Scryfall.get);
      state.colorsManual = '';
      await analyzePaste();
    } finally { state.rolling = false; }
  };

  $('newsDice').addEventListener('click', e => { e.preventDefault(); $('btnSample').click(); });

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
      if (!state.results.some(r => r.ok)) {
        status('Não reconheci nenhuma carta. Confira se os nomes estão em inglês, um por linha (ex.: 4 Lightning Bolt).', true);
        $('cardstage').classList.add('hidden');
      } else {
        status(mode === 'paste' ? 'Pronto! Mudou algo nos Ajustes? O resultado atualiza sozinho.' : `${decks.length} deck(s) analisado(s).`);
        showHand(true);
      }
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

  // ------------------------------------------------------------------ cartas com imagem (leque como o da home do Scryfall)
  function fanHtml(cards) {
    const n = cards.length, mid = (n - 1) / 2;
    return cards.map((c, i) => {
      const off = i - mid, rot = (off * 5).toFixed(1), y = Math.round(Math.abs(off) * Math.abs(off) * 3);
      const style = `transform: translateY(${y}px) rotate(${rot}deg); --i: ${i}`;
      const img = c.img ? `<img src="${esc(c.img)}" alt="${esc(c.name)}" loading="lazy" width="488" height="680">` : `<div class="noimg">${esc(c.name)}</div>`;
      const ext = c.uri ? `<a class="fx" href="${esc(c.uri)}" target="_blank" rel="noopener" title="Abrir ${esc(c.name)} no Scryfall">↗</a>` : '';
      return `<div class="fc${c.isLand ? ' land' : ''}" style="${style}" role="button" tabindex="0" title="${esc(c.name)} — clique para comprar outra mão">${img}${ext}</div>`;
    }).join('');
  }

  /** Cartas entram da direita para a esquerda, uma a uma (como carteando a mão), quando a seção aparece na tela. */
  function dealAnimation() {
    const fan = $('fan');
    fan.classList.remove('deal');
    void fan.offsetWidth;
    const W = window.innerWidth;
    fan.querySelectorAll('.fc').forEach(fc => fc.style.setProperty('--tx', Math.round(W - fc.getBoundingClientRect().left + 80) + 'px'));
    const io = new IntersectionObserver((entries, ob) => { if (entries[0].isIntersecting) { fan.classList.add('deal'); ob.disconnect(); } }, { threshold: 0.3 });
    io.observe(fan);
  }

  /** Mão inicial de 7 cartas do primeiro deck analisado, com contagem de terrenos, média das mãos e chances exatas. */
  const fanSubDefault = $('fanSub').innerHTML;
  function showHand(newDeck) {
    const r = state.results.find(x => x.ok);
    if (!r) return;
    const lib = r.cards.filter(c => !c.commander), cmdr = r.cards.filter(c => c.commander);   // comandante fica fora da biblioteca
    const total = lib.reduce((a, c) => a + c.qty, 0);
    const key = `${r.name}|${total}|${r.pureLands}`;
    if (newDeck || key !== state.handKey) { state.hands = []; state.handKey = key; }
    $('cardstage').classList.remove('hidden'); $('btnGrimoire').classList.remove('hidden');
    const { hand, lands } = Rules.drawHand(r.cards, 7);
    state.hands.push(lands); state.lastHand = hand.map(h => h.name);   // o playtest começa com esta mesma mão
    $('fanTitle').textContent = `Sua mão inicial${state.results.length > 1 ? ` (${r.name})` : ''}`;
    $('fan').innerHTML = fanHtml(hand.map(h => ({ name: h.name, img: h.card.img, uri: h.card.uri, isLand: h.cls.isLand })));
    const cz = $('cmdzone');
    cz.innerHTML = cmdr.map(c => { const img = c.card.img ? `<img src="${esc(c.card.img)}" alt="${esc(c.name)}" loading="lazy" width="488" height="680">` : `<div class="noimg">${esc(c.name)}</div>`; return `<a class="cmdcard" href="${esc(c.card.uri || '#')}" target="_blank" rel="noopener" title="${esc(c.name)} · zona de comando (abrir no Scryfall)">${img}<span class="cmdlabel">Comandante</span></a>`; }).join('');
    cz.classList.toggle('hidden', !cmdr.length);
    $('fanSub').innerHTML = cmdr.length ? `Sete cartas aleatórias do baralho, como numa partida. <b>O comandante fica na zona de comando, ao lado da mão</b>, e não entra no sorteio: as cartas saem das outras ${total}. <b>Clique em qualquer carta da mão para comprar outra</b>.` : fanSubDefault;
    dealAnimation();
    const verdict = lands <= 1 ? 'poucos terrenos: mão arriscada (considere um mulligan)' : lands >= 5 ? 'muitos terrenos: mão pesada (considere um mulligan)' : 'quantidade de terrenos boa para manter';
    $('fanInfo').textContent = `${lands} terreno(s) e ${7 - lands} mágica(s): ${verdict}.`;

    // média das mãos já compradas x esperado
    const n = state.hands.length, avg = state.hands.reduce((a, b) => a + b, 0) / n, exp = 7 * r.pureLands / total;
    const chips = state.hands.slice(-12).map(k => `<span class="hchip ${k >= 2 && k <= 4 ? 'ok' : 'bad'}" title="${k} terreno(s)">${k}</span>`).join('');
    $('handStats').innerHTML = `<span><b>${n}</b> mão(s) comprada(s)</span><span>média de <b>${f1(avg)}</b> terrenos <span class="muted-l">(esperado ${f1(exp)})</span></span><span class="hchips" title="terrenos em cada mão (verde = 2 a 4)">${chips}</span>`;

    // chance exata de cada quantidade de terrenos na mão
    const odds = Rules.handLandOdds(total, r.pureLands, 7), max = Math.max(...odds, 1e-9);
    $('odds').innerHTML = odds.map((p, k) => `<div class="oc"><span class="op">${Math.round(p * 100)}%</span><div class="ob${k >= 2 && k <= 4 ? ' keep' : ''}${k === lands ? ' now' : ''}" style="height:${Math.max(3, Math.round(100 * p / max))}%"></div><span class="ol">${k}</span></div>`).join('');
    const keepP = odds.slice(2, 5).reduce((a, b) => a + b, 0), lowP = odds[0] + odds[1], highP = odds.slice(5).reduce((a, b) => a + b, 0);
    $('oddsNote').textContent = `Com ${r.pureLands} terrenos em ${total} cartas${cmdr.length ? ' (fora o comandante)' : ''}: ${Math.round(keepP * 100)}% de chance de vir 2 a 4 terrenos (mão boa de manter), ${Math.round(lowP * 100)}% de vir 0 ou 1 e ${Math.round(highP * 100)}% de vir 5 ou mais. A barra com contorno dourado é a mão que você acabou de comprar.`;
  }
  $('btnFan').onclick = () => showHand(false);
  const startPlaytest = () => { const r = state.results.find(x => x.ok); if (r) Playtest.open(r.cards, { hand: state.lastHand }); };
  $('btnGrimoire').onclick = startPlaytest;
  // clicar em qualquer carta da mão compra outra mão (o "↗" abre a carta no Scryfall)
  $('fan').addEventListener('click', e => { if (e.target.closest('.fx')) return; if (e.target.closest('.fc')) showHand(false); });
  $('fan').addEventListener('keydown', e => { if ((e.key === 'Enter' || e.key === ' ') && e.target.classList.contains('fc')) { e.preventDefault(); showHand(false); } });

  // ------------------------------------------------------------------ resultado
  function sourceCard(x) {
    const pct = x.needed ? Math.min(100, Math.round(100 * x.current / x.needed)) : 100;
    const falta = x.needed - x.current;
    const st = x.current >= x.needed - 1e-9 ? '<span class="pos">suficiente</span>' : `<span class="neg">faltam ≈ ${num(falta)}</span>`;
    return `<div class="src c${x.color}">
      <div class="srchead">${Mana.icon(x.color, 30)}<b>${COLOR_NAMES[x.color]}</b></div>
      <div class="srcnum"><span class="n2">${x.needed}</span><span>fontes necessárias</span></div>
      <div class="bar2"><i style="width:${pct}%"></i></div>
      <p class="barlbl">Nos seus terrenos hoje: <b>${num(x.current)}</b> · ${st}</p>
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
    // seletor de arquétipo no próprio resultado: já vem preenchido (automático) e pode ser trocado; "automático" desfaz a troca
    const autoArch = auto(p.archetype) ? r.archetype : Pipeline.evaluateDeck({ ...d, params: { ...p, archetype: 'Auto' } }, Scryfall.get).archetype;
    const archSelect = `<select data-i="${i}" data-k="archetype" aria-label="Arquétipo do deck">${auto(p.archetype)
      ? Rules.ARCHETYPES.map(a => a === r.archetype ? `<option value="Auto" selected>${a} (automático)</option>` : `<option value="${a}">${a}</option>`).join('')
      : `<option value="Auto">↺ automático (${autoArch})</option>` + Rules.ARCHETYPES.map(a => `<option value="${a}"${a === r.archetype ? ' selected' : ''}>${a}</option>`).join('')}</select>`;
    const sizeCur = auto(p.size) ? 'Auto' : r.size;
    const compCur = auto(p.companion) ? 'Auto' : (r.companion ? 'Sim' : 'Não');
    const chips = 'WUBRG'.split('').map(c => `<span class="chip${r.colorsList.includes(c) ? ' on' : ''}" data-c="${c}" data-i="${i}" title="${COLOR_NAMES[c]}">${chipHtml(c)}</span>`).join('');
    const pipsBadge = r.colorsList ? r.colorsList.split('').map(c => Mana.icon(c, 16)).join('') : '<span class="muted">sem cor</span>';
    const flagged = r.cards.filter(c => c.cls.draw || c.cls.ramp || c.cls.mdfc).sort((a, b) => a.name.localeCompare(b.name));
    const excluded = d.excluded || new Set();
    const rows = flagged.map(c => `<tr><td>${c.qty}</td><td>${esc(c.name)}</td><td class="cost">${Mana.cost(frontCost(c.card), 15)}</td><td>${c.cls.draw ? '<span class="tag draw">compra barata</span>' : ''}${c.cls.ramp ? '<span class="tag ramp">aceleração barata</span>' : ''}${c.cls.mdfc ? `<span class="tag mdfc">MDFC ${c.cls.mdfc === 'mythic' ? 'mítico (0,74)' : '(0,38)'}</span>` : ''}</td><td>${c.cls.draw || c.cls.ramp ? `<input type="checkbox" checked data-i="${i}" data-x="${esc(c.name)}">` : ''}</td></tr>`).join('');
    const exRows = [...excluded].map(n => `<tr><td></td><td>${esc(n)}</td><td></td><td><span class="muted">fora da contagem</span></td><td><input type="checkbox" data-i="${i}" data-x="${esc(n)}"></td></tr>`).join('');
    const fr = r.free || { list: [], enablers: [] };
    const freeRows = fr.list.map(f => `<tr><td>${f.qty}</td><td>${esc(f.name)}</td><td class="num">${f.cmc}</td><td>${f.by === 'custo alternativo' ? '<span class="tag draw">custo alternativo</span>' : `<span class="tag ramp">entra de graça com ${esc(f.by || 'um cheat')}</span>`}</td><td><input type="checkbox" ${f.on ? 'checked ' : ''}data-i="${i}" data-f="${esc(f.name)}"></td></tr>`).join('');
    const enablerNote = fr.enablers.length ? `<p class="muted small">Põem cartas da mão no jogo sem pagar: <b>${fr.enablers.map(e => esc(e.name)).join(', ')}</b>. Com ${fr.enablers.length > 1 ? 'elas' : 'ela'} no deck, cartas de custo ${Math.max(5, Math.min(...fr.enablers.map(e => e.cmc)) + 1)}+ dos tipos liberados são tratadas como free spells.</p>` : '';
    const freeBlock = (fr.list.length || fr.enablers.length) ? `<details class="more"><summary>Free spells fora da conta das fontes <span class="hint">(${fr.list.filter(f => f.on).length} carta(s); marque ou desmarque para corrigir)</span></summary><div class="inner">
        <p class="muted small">Free spell é a carta que dá para jogar sem pagar o custo de mana (Force of Will, Fireblast, Solitude…) ou que entra no jogo de graça por um cheat (Show and Tell, Braids, Sneak Attack…). Os símbolos de mana dela não contam para as fontes de cada cor.</p>${enablerNote}
        ${freeRows ? `<table><thead><tr><th>Qtd</th><th>Carta</th><th class="num">Custo</th><th>Por quê</th><th>Fora da conta?</th></tr></thead><tbody>${freeRows}</tbody></table>` : ''}
      </div></details>` : '';
    const warn = r.warnings.length ? `<p class="warn">${r.warnings.map(esc).join('<br>')}</p>` : '';
    const advice = Pipeline.adviceFor(r).map(a => `<li class="${a.kind === 'todo' ? 'todo-fix' : ''}">${esc(a.text)}</li>`).join('');
    const pills = r.sources.rows.map(x => `<span class="pill">${Mana.icon(x.color, 26)}<b>${x.needed}</b><small>fontes de ${COLOR_NAMES[x.color].toLowerCase()}</small></span>`).join('');
    const srcTable = r.sources.rows.map(x => {
      const faixa = x.tableRange ? (x.tableRange[0] === x.tableRange[1] ? `${x.tableRange[0]}` : `${x.tableRange[0]}–${x.tableRange[1]}`) + ` (${x.multiPip >= 4 ? '4+' : x.multiPip} pips)` : '–';
      return `<tr><td>${Mana.icon(x.color, 16)} ${COLOR_NAMES[x.color]}</td><td class="num">${num(x.pips)}</td><td class="num">${Math.round(x.share * 100)}%</td><td class="num">${x.byFormula}</td><td class="num">${faixa}</td><td class="num"><b>${x.needed}</b></td><td class="num">${x.rampCredit ? f1(x.rampCredit) : '–'}</td><td class="num">${x.fromLands}</td><td class="num">${num(x.current)}</td></tr>`;
    }).join('');
    const adjust = state.mode === 'excel' ? `
      <details class="more"><summary>Ajustar arquétipo, tamanho, companion ou cores deste deck <span class="hint">(tudo automático)</span></summary><div class="inner">
        <div class="grid">
          <div><label>Arquétipo <span class="muted">(${esc(r.archetypeSource)})</span></label>${sel('archetype', [['Auto', 'Auto'], ...Rules.ARCHETYPES.map(a => [a, a])], archCur)}</div>
          <div><label>Tamanho <span class="muted">(${esc(r.sizeSource)})</span></label>${sel('size', [['Auto', 'Auto'], [40, '40 cartas'], [60, '60 cartas'], [100, '100 cartas']], sizeCur)}</div>
          <div><label>Companion <span class="muted">(${esc(r.companionSource)})</span></label>${sel('companion', [['Auto', 'Auto'], ['Sim', 'Sim'], ['Não', 'Não']], compCur)}</div>
          <div><label>Cores <span class="muted">(${esc(r.colorsSource)})</span></label><div class="chips">${chips}<span class="chip" data-i="${i}" data-auto="1">Auto</span></div></div>
        </div></div></details>` : '';
    return `<article class="deck">
      <div class="deckhead"><h3>${esc(r.name)}</h3>
        <div class="meta">
          <span class="badge"><b>${r.mainTotal}</b> cartas</span>
          <label class="badge archpick" title="Estilo de jogo do deck. Já vem preenchido pelo site, mas você pode trocar: o número de terrenos é recalculado na hora.">Arquétipo ${archSelect}</label>
          <span class="badge">Cores ${pipsBadge}</span>
          <span class="badge">${r.pureLands} terrenos + ${f2(r.currentLands - r.pureLands)} de MDFC</span>
        </div></div>

      <div class="answer">
        <div class="big-n">${r.rounded}</div>
        <div class="big-l"><b>terrenos recomendados</b>número exato do modelo: ${f2(r.lands)}</div>
        <div class="srcpills">${pills}<button class="ghost small copybtn" type="button" data-i="${i}">Copiar resumo</button></div>
      </div>
      ${warn}

      <h4>O que fazer agora</h4>
      <ul class="todo">${advice}</ul>

      <h4>Fontes de mana por cor <span class="muted small">(para ${r.sources.lands} terrenos)</span></h4>
      <p class="muted small" style="margin:2px 0 0">Fonte = terreno que produz aquela cor. Ex.: 17 fontes de azul quer dizer que 17 dos seus terrenos precisam gerar mana azul.</p>
      <div class="srcgrid">${r.sources.rows.map(sourceCard).join('')}</div>

      <details class="more"><summary>Como calculamos as fontes <span class="hint">(fórmula e tabela por cor)</span></summary><div class="inner">
        <table><thead><tr><th>Cor</th><th class="num">Pips</th><th class="num">% dos pips</th><th class="num">Fórmula</th><th class="num">Tabela (pips múltiplos)</th><th class="num">Necessárias</th><th class="num">Crédito de ramp</th><th class="num">Terrenos devem dar</th><th class="num">Hoje</th></tr></thead><tbody>${srcTable}</tbody></table>
        <p class="muted small">Fontes = (pips da cor ÷ total de pips) × terrenos, arredondado para cima; pips múltiplos (CC, CCC…) seguem a tabela; criaturas valem 1/3 de fonte e artefatos 2/3; free spells ficam fora; o resultado nunca passa do total de terrenos. Fetch lands (Scalding Tarn, Evolving Wilds…) puxam a cor que você precisar, então contam como fonte das cinco cores.</p>
      </div></details>

      <details class="more"><summary>Números do modelo <span class="hint">(faixa de erro, Karsten, CMC)</span></summary><div class="inner">
        <div class="kpis">
          <div class="kpi main"><span class="k">Terrenos recomendados</span><span class="v">${f2(r.lands)}</span><span class="s">≈ ${r.rounded} · faixa típica ${f1(r.low)} a ${f1(r.high)}</span></div>
          <div class="kpi"><span class="k">Seu deck hoje</span><span class="v">${f2(r.currentLands)}</span><span class="s">${cmp}</span></div>
          <div class="kpi"><span class="k">Karsten (referência)</span><span class="v">${f2(r.karsten)}</span><span class="s">modelo anterior</span></div>
          <div class="kpi"><span class="k">CMC · compra · ramp</span><span class="v">${f2(r.cmc)}</span><span class="s">${r.draw} compra · ${r.ramp} aceleração</span></div>
        </div></div></details>

      ${adjust}

      ${freeBlock}

      <details class="more"><summary>Cartas que entram na conta <span class="hint">(desmarque para tirar da contagem)</span></summary><div class="inner">
        <table><thead><tr><th>Qtd</th><th>Carta</th><th>Custo</th><th>Classificação</th><th>Conta?</th></tr></thead><tbody>${rows}${exRows}</tbody></table>
      </div></details>

      <details class="more"><summary>Ver a conta <span class="hint">(passo a passo da fórmula)</span></summary><div class="inner"><pre>${esc(explain(r))}</pre></div></details>
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
    // mantém abertos os blocos que o usuário abriu
    const open = new Set([...document.querySelectorAll('#decks details[open]')].map(d => d.querySelector('summary').firstChild.textContent.trim()));
    $('decks').innerHTML = state.results.map(deckHtml).join('');
    document.querySelectorAll('#decks details').forEach(d => { if (open.has(d.querySelector('summary').firstChild.textContent.trim())) d.open = true; });
  }

  // ------------------------------------------------------------------ ajustes por deck (modo Excel) e copiar resumo
  $('decks').addEventListener('change', e => {
    const t = e.target, i = +t.dataset.i;
    if (Number.isNaN(i) || !state.decks[i]) return;
    const d = state.decks[i];
    if (t.dataset.k) {
      d.params[t.dataset.k] = t.value;
      if (state.mode === 'paste' && t.dataset.k === 'archetype') $('optArch').value = t.value;   // mantém o campo de Ajustes igual
      recalc();
    }
    else if (t.dataset.f !== undefined) { d.freeOverride = d.freeOverride || new Map(); d.freeOverride.set(t.dataset.f, t.checked); recalc(); }
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

  if (window.matchMedia && matchMedia('(pointer: fine)').matches) $('deckText').focus();   // no computador já deixa o cursor na caixa; no celular não abre o teclado sozinho
})();
