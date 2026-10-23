/*
 * Template Excel e planilha de resultado (usa XlsxLite). Compartilhado entre o site e o gerador estático.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./xlsx-lite.js'), require('./rules.js'));
  else root.Template = factory(root.XlsxLite, root.Rules);
})(typeof self !== 'undefined' ? self : this, function (X, Rules) {
  'use strict';

  const TITLE = 3, WRAP = 2, NUM = 4;
  const N = 200;   // linhas pré-validadas

  function buildTemplate() {
    const instr = [
      [{ v: 'Calculadora de Terrenos · Magic: The Gathering', s: TITLE }],
      [''],
      [{ v: 'Como usar', s: 1 }],
      [{ v: '1) Aba "Cartas": uma linha por carta. Preencha Deck, Quantidade e Carta (nome em inglês, como na Arena/Moxfield). Seção = Main ou Side (vazio = Main). Se o nome do deck ficar vazio, vale o da linha de cima.', s: WRAP }],
      [{ v: '   Dica: dá para colar direto a lista exportada do Archidekt (More > Export deck > Text) na coluna Carta, linha por linha, como "1x Sol Ring (c21) 263 [Ramp]". Cartas em Maybeboard são ignoradas.', s: WRAP }],
      [{ v: '2) Aba "Decks" (opcional): um deck por linha. Deixe "Auto" onde não souber: o site descobre sozinho. Preencher só ajuda a refinar.', s: WRAP }],
      [{ v: '3) Salve o arquivo e envie no site. Você recebe o número de terrenos recomendado por deck e pode baixar o resultado em Excel.', s: WRAP }],
      [''],
      [{ v: 'O que cada campo significa', s: 1 }],
      [{ v: 'Arquétipo: Aggro, Tempo, Midrange, Control, Combo, Ramp ou Lands. Auto = o site sugere pelo nome do deck e pelas cartas (mesmas regras do TCC).', s: WRAP }],
      [{ v: 'Tamanho: 40, 60 ou 100 cartas. Auto = pelo total do main deck.', s: WRAP }],
      [{ v: 'Companion: Sim/Não. Auto = detecta se há uma carta com Companion no sideboard.', s: WRAP }],
      [{ v: 'Cores: letras WUBRG (W branco, U azul, B preto, R vermelho, G verde), ex.: UB. Vazio = detecta pelo nome do deck, terrenos básicos ou cores das mágicas.', s: WRAP }],
      [''],
      [{ v: 'Como o número é calculado', s: 1 }],
      [{ v: 'Regressão linear múltipla (Penatti & Costa, 2026) sobre 39.287 decks vencedores, com custo médio de mana, compra e aceleração baratas (CMC ≤ 2), companion, número de cores, arquétipo e interação cor × arquétipo. Estende o modelo de Frank Karsten (TCGplayer, 2022). As cartas são lidas ao vivo no Scryfall, então sets novos entram automaticamente.', s: WRAP }],
      [{ v: 'MDFC terreno/mágica contam como 0,38 terreno (não míticos) ou 0,74 (míticos). Para 40 e 100 cartas, a fórmula é escalada proporcionalmente (aproximação).', s: WRAP }],
      [{ v: 'O resultado é um ponto de partida: o erro típico do modelo é de cerca de ±1,8 terreno.', s: WRAP }],
    ];

    const decks = [['Deck', 'Arquétipo', 'Tamanho', 'Companion', 'Cores'], ['Exemplo (apague ou edite)', 'Auto', 'Auto', 'Auto', '']];
    const sample = [
      [4, 'Llanowar Elves'], [4, 'Growth Spiral'], [4, 'Hydroid Krasis'], [3, 'Elspeth Conquers Death'], [4, 'Jwari Disruption'],
      [2, "Emeria's Call"], [4, 'Shark Typhoon'], [3, "Uro, Titan of Nature's Wrath"], [4, 'Brainstorm'],
      [4, 'Breeding Pool'], [4, 'Hinterland Harbor'], [4, 'Temple Garden'], [6, 'Forest'], [5, 'Island'], [5, 'Plains'],
    ];
    const cards = [['Deck', 'Quantidade', 'Carta', 'Seção']];
    sample.forEach(([q, n], i) => cards.push([i === 0 ? 'Exemplo (apague ou edite)' : '', q, n, 'Main']));
    cards.push(['', 1, 'Lurrus of the Dream-Den', 'Side']);

    return X.writeXlsx([
      { name: 'Instruções', rows: instr, widths: [110] },
      { name: 'Decks', rows: decks, widths: [34, 14, 12, 14, 12], header: true, validations: [
        { sqref: `B2:B${N}`, list: ['Auto', ...Rules.ARCHETYPES] },
        { sqref: `C2:C${N}`, list: ['Auto', '40', '60', '100'] },
        { sqref: `D2:D${N}`, list: ['Auto', 'Sim', 'Não'] },
      ] },
      { name: 'Cartas', rows: cards, widths: [34, 12, 42, 10], header: true, validations: [
        { sqref: `D2:D${N * 5}`, list: ['Main', 'Side'] },
      ] },
    ]);
  }

  const fmt = (x, d = 2) => Math.round(x * 10 ** d) / 10 ** d;

  /** results: saída de Pipeline.evaluateDeck[]. -> Uint8Array (.xlsx) */
  function buildResults(results) {
    const sum = [['Deck', 'Terrenos recomendados', 'Arredondado', 'Faixa típica (±1 RMSE)', 'Terrenos atuais (MDFC ponderado)', 'Ajuste sugerido', 'Karsten (referência)',
      'CMC (mágicas)', 'Compra barata', 'Aceleração barata', 'Companion', 'Cores', 'Arquétipo', 'Origem do arquétipo', 'Tamanho', 'Avisos']];
    const cards = [['Deck', 'Quantidade', 'Carta', 'Tipo', 'CMC', 'Classificação']];
    for (const r of results) {
      if (!r.ok) { sum.push([r.name, 'erro: ' + r.error, '', '', '', '', '', '', '', '', '', '', '', '', '', (r.warnings || []).join(' | ')]); continue; }
      sum.push([r.name, { v: fmt(r.lands), s: NUM }, r.rounded, `${fmt(r.low, 1)} a ${fmt(r.high, 1)}`, { v: fmt(r.currentLands), s: NUM },
        { v: fmt(r.delta), s: NUM }, { v: fmt(r.karsten), s: NUM }, { v: fmt(r.cmc), s: NUM }, r.draw, r.ramp, r.companion ? 'Sim' : 'Não',
        r.colorsList, r.archetype, r.archetypeSource, r.size, r.warnings.join(' | ')]);
      for (const c of r.cards.slice().sort((a, b) => a.name.localeCompare(b.name))) {
        const cls = c.cls.isLand ? 'Terreno' : [c.cls.mdfc ? `MDFC ${c.cls.mdfc === 'mythic' ? 'mítico (0,74)' : '(0,38)'}` : '', c.cls.draw ? 'compra barata' : '', c.cls.ramp ? 'aceleração barata' : ''].filter(Boolean).join(' + ') || 'Mágica';
        cards.push([r.name, c.qty, c.name, c.cls.isLand ? 'Terreno' : 'Mágica', c.cls.isLand ? '' : c.cls.cmc, cls]);
      }
      for (const m of r.missing) cards.push([r.name, '', m, 'NÃO ENCONTRADA', '', 'ignorada no cálculo']);
    }
    const COLOR_PT = { W: 'Branco', U: 'Azul', B: 'Preto', R: 'Vermelho', G: 'Verde' };
    const src = [['Deck', 'Cor', 'Pips', '% dos pips', 'Fontes pela fórmula', 'Pips da cor na carta que mais exige', 'Faixa da tabela (pips múltiplos)', 'Fontes necessárias', 'Crédito de ramp (criaturas 1/3, artefatos 2/3)', 'Terrenos devem fornecer', 'Fontes nos seus terrenos hoje']];
    for (const r of results) {
      if (!r.ok) continue;
      for (const x of r.sources.rows) {
        src.push([r.name, COLOR_PT[x.color], { v: fmt(x.pips, 1), s: NUM }, `${Math.round(x.share * 100)}%`, x.byFormula, x.multiPip > 1 ? x.multiPip : 1,
          x.tableRange ? (x.tableRange[0] === x.tableRange[1] ? String(x.tableRange[0]) : `${x.tableRange[0]}-${x.tableRange[1]}`) : '', x.needed, { v: fmt(x.rampCredit), s: NUM }, x.fromLands, { v: fmt(x.current), s: NUM }]);
      }
    }
    return X.writeXlsx([
      { name: 'Resumo', rows: sum, header: true, widths: [30, 14, 12, 18, 18, 14, 14, 12, 12, 14, 11, 9, 12, 24, 9, 70] },
      { name: 'Fontes de mana', rows: src, header: true, widths: [30, 10, 8, 11, 14, 20, 18, 14, 22, 16, 18] },
      { name: 'Cartas', rows: cards, header: true, widths: [30, 11, 40, 15, 7, 38] },
    ]);
  }

  return { buildTemplate, buildResults };
});
