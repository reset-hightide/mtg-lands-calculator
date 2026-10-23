# Calculadora de Terrenos · Magic: The Gathering

Recomenda quantos terrenos usar em um deck de Magic com **regressão linear múltipla** (custo médio de mana, compra e aceleração baratas, companion, número de cores, arquétipo e interação cor × arquétipo). É a aplicação do trabalho *Fatores associados à quantidade de terrenos em baralhos de jogos estratégicos de cartas* (Penatti & Costa, 2026), que estende o modelo de Frank Karsten ([TCGplayer, 2022](https://www.tcgplayer.com/content/article/How-Many-Lands-Do-You-Need-in-Your-Deck-An-Updated-Analysis/cd1c1a24-d439-4a8e-b369-b936edb0b38a/)).

Site estático, sem servidor e sem dependências externas de código: tudo roda no navegador.

## O que tem

| Página | Para quê |
|---|---|
| `index.html` | Baixe o template Excel, preencha (vários decks por arquivo), envie e receba a recomendação por deck. Também aceita lista colada (Arena, MTGO, Moxfield). |
| `base.html` | Tabela navegável (filtros, ordenação, download CSV) dos 39.287 decks usados para estimar o modelo. |
| `sobre.html` | Equações, desempenho, regras de leitura das cartas e limitações. |

Também calcula as **fontes de mana por cor** (método dos pips: pips da cor ÷ total de pips × terrenos, tabela para pips múltiplos e crédito de ramp) e lê listas exportadas do **Archidekt** (`1x Nome (set) 123 *F* [Categoria]`, ignorando Maybeboard), além de Arena, MTGO e Moxfield.

Recursos da calculadora: arquétipo, cores, tamanho do deck e companion detectados automaticamente (e editáveis), faixa típica de erro (±1 RMSE), comparação com o modelo de Karsten, diferença para a quantidade de terrenos atual (MDFC ponderados), lista das cartas contadas como compra/aceleração barata (com opção de tirar cartas da contagem) e download do resultado em Excel.

## Como as cartas são lidas

As cartas vêm da [API do Scryfall](https://scryfall.com/docs/api) em tempo real, então novos sets entram automaticamente. As regras de compra/aceleração barata (CMC ≤ 2) seguem o artigo do Karsten; MDFC terreno/mágica contam como 0,38 (não míticos) ou 0,74 (míticos) terreno. O arquétipo e as cores automáticos reproduzem as fórmulas do Excel do trabalho.

## Validação

- Modelo reproduz o trabalho na base completa: R² = 0,567, MAE = 1,30 (`tests/rules.test.js`).
- Reestimar a regressão (`tools/build_data.py`) devolve os coeficientes publicados (CMC, compra, aceleração e cores na 3ª casa; termos de arquétipo dentro de ~0,1).
- Regras de arquétipo e cores: 100% de concordância com as colunas do Excel do trabalho em 400 decks.
- Regras de carta contra o Scryfall atual, em 392 decks da base: compra+aceleração iguais às do Karsten em 97,7% dos decks; diferença média ≈ 0,02 terreno.
- Leitura/escrita de `.xlsx`, parser de listas, fórmulas escaladas para 40/60/100 cartas e fluxos da interface (ver `tests/`).

```bash
node --test tests/          # testes unitários (Node ≥ 18)
python tools/serve.py 8765  # servidor local sem cache para abrir o site
```

Alguns testes usam `data/validation_sample.json` (400 decks com texto da página de origem), que não é publicado; ele é gerado por `tools/build_data.py` a partir da planilha do trabalho e, sem ele, esses testes são pulados.

## Estrutura

```
index.html  base.html  sobre.html
css/style.css
js/rules.js        modelo, regras de carta, arquétipo e cores
js/pipeline.js     planilha/lista -> resultado por deck
js/scryfall.js     cliente da API (lote, cache de 7 dias)
js/xlsx-lite.js    leitura e escrita de .xlsx sem dependências
js/template.js     template Excel e planilha de resultado
js/app.js  js/base.js
data/decks.csv     base de 39.287 decks (tabela)
data/model_fit.json  coeficientes publicados x reestimados
template/          template Excel pré-gerado
tests/  tools/
```

## Limitações

Modelo estimado com decks de 60 cartas (2020–2022); 40 e 100 cartas são extrapolação proporcional. O erro típico é de ±1,8 terreno: use o resultado como ponto de partida.

## Créditos

Penatti, B. G. I.; Costa, I. P. A. (2026). Frank Karsten, *How Many Lands Do You Need in Your Deck? An Updated Analysis* (TCGplayer, 2022) e *MTG Lands Dataset* (Kaggle). Dados de cartas: Scryfall. Projeto não afiliado à Wizards of the Coast.
