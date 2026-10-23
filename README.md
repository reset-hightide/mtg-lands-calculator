# Calculadora de Terrenos · Magic: The Gathering

### 👉 Use agora: **https://reset-hightide.github.io/mtg-lands-calculator/**

<p align="center">
<a href="https://scryfall.com/card/apc/11"><img src="https://cards.scryfall.io/normal/front/c/c/ccca800f-e850-4bec-95d0-70280b51b7a7.jpg" alt="Gerrard Capashen" width="126"></a> <a href="https://scryfall.com/card/inv/237"><img src="https://cards.scryfall.io/normal/front/d/2/d24d441c-f37f-44fe-8a93-f5c89df807e4.jpg" alt="Captain Sisay" width="126"></a> <a href="https://scryfall.com/card/inv/249"><img src="https://cards.scryfall.io/normal/front/8/3/83a4e48d-6452-4245-bdad-63fe3263550e.jpg" alt="Hanna, Ship's Navigator" width="126"></a> <a href="https://scryfall.com/card/all/28"><img src="https://cards.scryfall.io/normal/front/9/a/9a879b60-4381-447d-8a5a-8e0b6a1d49ca.jpg" alt="Force of Will" width="126"></a> <a href="https://scryfall.com/card/exo/114"><img src="https://cards.scryfall.io/normal/front/6/d/6d1682dd-5a99-4bee-a2c2-c8735047e1a9.jpg" alt="Mirri, Cat Warrior" width="126"></a> <a href="https://scryfall.com/card/tmp/33"><img src="https://cards.scryfall.io/normal/front/7/0/7086d077-f083-4870-8b0b-2d34aca49df1.jpg" alt="Orim, Samite Healer" width="126"></a> 
</p>

<p align="center"><sub>Gerrard, Sisay, Hanna e a turma da Weatherlight (mais a Force of Will). Imagens e dados das cartas: <a href="https://scryfall.com">Scryfall</a>.</sub></p>

Quantos terrenos o seu deck precisa? E quantas fontes de cada cor? Cole a lista do seu deck, clique em **Calcular** e pronto: a resposta aparece na hora, com os símbolos de mana, as cartas da sua mão inicial e uma explicação em linguagem de gente.

## Como usar (leva 10 segundos)

1. **Cole a lista** do seu deck (Archidekt, Arena, MTGO ou Moxfield). Sem lista na mão? Clique em **Sortear um deck de exemplo** e gire a Roda da Fortuna.
2. **Leia a resposta**: o número de terrenos recomendado e as fontes de mana de cada cor. Tamanho do deck, cores e arquétipo já vêm preenchidos sozinhos, e você pode trocar qualquer um com um clique.
3. **Compre uma mão de 7 cartas** e veja quantos terrenos costumam vir. Clicou numa carta? Sai outra mão.

Tem vários decks para conferir de uma vez? Baixe o **template em Excel**, preencha e envie de volta.

## De onde vem o cálculo

Do meu TCC, publicado como artigo: [*Fatores associados à quantidade de terrenos em baralhos de jogos estratégicos de cartas*](https://revistaes.com.br/artigos/fatores-associados-a-quantidade-de-terrenos-em-baralhos-de-jogos-estrategicos-de-cartas) (Penatti & Costa, 2026, Revista E&S, DOI [10.22167/2675-6528-202601753](https://doi.org/10.22167/2675-6528-202601753)). Analisei 39.287 decks vencedores e montei uma **regressão linear múltipla** que olha para o custo médio de mana, as cartas baratas de compra e aceleração, o companion, o número de cores, o arquétipo e como cor e arquétipo se combinam. É uma extensão do modelo de Frank Karsten ([TCGplayer, 2022](https://www.tcgplayer.com/content/article/How-Many-Lands-Do-You-Need-in-Your-Deck-An-Updated-Analysis/cd1c1a24-d439-4a8e-b369-b936edb0b38a/)).

Quanto às fontes de mana, o método é o dos pips: se metade dos símbolos de custo do deck é azul, metade dos terrenos deveria produzir azul, com ajustes para custos pesados (como {U}{U}{U}), para aceleradores de mana e para fetch lands, que valem como fonte das cinco cores.

Tudo roda no seu navegador: sem servidor, sem cadastro, sem instalar nada. As cartas vêm do [Scryfall](https://scryfall.com/docs/api) em tempo real, então sets novos entram sozinhos.

> O modelo erra, em média, cerca de 1,8 terreno para cima ou para baixo. Use o resultado como um ótimo ponto de partida para o seu deckbuilding, não como lei.

## Os dados

A base usada para estimar o modelo tem **39.287 decks vencedores** de torneios, com o número de terrenos, o custo médio de mana, as cores, o arquétipo e as cartas baratas de compra e aceleração de cada um. Você pode navegar por ela, filtrar, ordenar e baixar tudo em CSV na página **[Base de dados](https://reset-hightide.github.io/mtg-lands-calculator/base.html)** do site. Para usar a calculadora, o endereço é **https://reset-hightide.github.io/mtg-lands-calculator/**.

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
- Ponta a ponta (lista -> Scryfall -> regras -> fórmula) em 392 decks reais da base: com arquétipo e cores informados, a diferença média para o modelo do trabalho é de 0,03 terreno (97,7% dos decks a menos de 0,1); no modo automático, 0,10 (91,3% a menos de 0,1). Contra o número real de terrenos, o erro é o mesmo do trabalho (MAE ≈ 1,4 nessa amostra).
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
js/wheel.js        Roda da Fortuna (sorteio do deck de exemplo)
js/examples.js     decks de exemplo no formato do Archidekt
js/mana.js         símbolos de mana
js/app.js  js/base.js
img/cena.webp      arte da roda
data/decks.csv     base de 39.287 decks (tabela)
data/model_fit.json  coeficientes publicados x reestimados
template/          template Excel pré-gerado
tests/  tools/
```

## Limitações

Modelo estimado com decks de 60 cartas (2020–2022); 40 e 100 cartas são extrapolação proporcional. O erro típico é de ±1,8 terreno: use o resultado como ponto de partida.

## Créditos

Penatti, B. G. I.; Costa, I. P. A. (2026). Fatores associados à quantidade de terrenos em baralhos de jogos estratégicos de cartas. Revista E&S. https://doi.org/10.22167/2675-6528-202601753. Frank Karsten, *How Many Lands Do You Need in Your Deck? An Updated Analysis* (TCGplayer, 2022) e *MTG Lands Dataset* (Kaggle). Dados de cartas: Scryfall. Projeto não afiliado à Wizards of the Coast.
