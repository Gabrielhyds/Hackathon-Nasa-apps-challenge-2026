# Próximos passos

Lista única do que falta no Nexxus, para trabalhar em paralelo. Cada item diz quem faz, onde mexer e quando está pronto, para qualquer pessoa ou agente pegar sem precisar da conversa em que surgiu. Leia junto com o `CLAUDE.md`.

Pegou um item: escreva seu nome nele e commite, para ninguém fazer duas vezes. Terminou: apague o item (o histórico do git guarda) e, se mudou algo que vale para todos, registre no `CLAUDE.md`. Ideia nova entra aqui. Funcionalidades congelam domingo às 15h.

Parte destas ideias vem do explicador "Radar, Fourier e franjas" (protótipo em português do Mateus: através das nuvens, compressão de pulso, régua de 12 cm, Fourier alinhando as imagens) e do pacote `nexxus-handoff` (`HANDOFF.md` e o doc "Nexxus: planos para o hackathon"), que não estão no repositório: peça ao Mateus.

## Números do Taquari

Os números atuais estão só no `CLAUDE.md` (O que ainda é exemplo, Imagens de radar): a água aberta nova medida no GCOV em 23/07/2026, com a faixa, sem citar total de água nem área alagada. Números antigos que ainda circulam e precisam sair: "57 km²" (roteiro da demo), "46 km² a mais" e "53 km² no total" (explicador), "46,7 km²" (handoff), "51 km², de 41 a 51" (no `CLAUDE.md` até 14/11), "é preview de 8 bits" (linha de riscos do doc de planos).

## Antes do congelamento

### 4. Agente real (Vitor)

Integrado em 15/11: o agente está em `apps/agent`, sobe no Docker e a aba Ask mostra resposta, ressalva, fontes e cenas citadas (O agente, no `CLAUDE.md`). Falta:

- Pôr `GEMINI_API_KEY` no `.env` da máquina da demo e conferir no navegador uma resposta escrita pelo modelo (a integração foi vista na tela só no modo reserva, sem chave).
- Gerar e commitar `apps/agent/data/respostas_prontas.json` (`python scripts/aquecer.py`, com a chave), para as perguntas prováveis não gastarem cota.
- No modo reserva, com uma cena aberta, pergunta fora do assunto ("Qual a capital da França?") devolve o cartão da cena em vez de "não sei": o bônus da cena aberta em `retrieve` (`agent/knowledge.py`) vale mesmo sem nenhum termo em comum.
- O agente não recebe a conversa anterior: pergunta de seguimento ("e por quê?") é respondida sem o contexto. Decidir se vale mandar o histórico.
- Os fatos das cenas existem em dois lugares, a fixture e os cartões. Conferir um contra o outro a cada mudança.

### 5. Publicar o ambiente (dono a definir)

- **O quê:** página e API num endereço público, para quem avalia abrir sem Docker. Falta decidir onde hospedar e quem faz.
- **Onde mexer:** o `docker compose up -d --build` já sobe os dois. Em outro domínio, `VITE_API_URL` e `PUBLIC_API_URL` no `.env` (Trocar exemplo por dado real, itens 1 e 4, no `CLAUDE.md`); com proxy na frente, sem buffer em `/api/` (Cuidados conhecidos).
- **Pronto quando:** o link abre de fora da rede do time com as cenas e as imagens reais, e `GET /api/health` responde.

### 6. Números do Taquari nos textos (Laís)

- Roteiro da demo, doc de planos e rascunhos da página do projeto: trocar os números antigos listados acima pelos do `CLAUDE.md`.
- A reportagem do Brasil de Fato de 23/07/2026, fonte das leituras do rio na manhã seguinte à cheia (`riverGauge` na fixture), fala em 1,1 mil pessoas fora de casa, embora o endereço da página diga "11-mil": se o número entrar na narrativa, conferir na página.

### 7. Compressão de pulso e régua de 12 cm na página do projeto e no vídeo (Laís)

- Partes 2 e 3 do explicador, em inglês. Explicam como o radar funciona por dentro e ajudam na categoria Best Use of Science, mas não ajudam a ler as cenas, então não precisam estar no app.
- Conteúdo: o radar manda um chirp longo, e o filtro casado (Fourier) junta a energia num pico estreito; o ganho é banda × duração e a resolução é c/2B (40 MHz nas cenas, cerca de 3,75 m). A onda do NISAR tem 24 cm e o caminho é de ida e volta, então cada ciclo de cor de um interferograma vale 12 cm de movimento na direção do satélite; nos terremotos de 24/06/2026, no norte da Venezuela, a NASA mediu até 60 cm de deslocamento para oeste, valor preliminar (NASA Earth Observatory).
- A duração do pulso no explicador é ilustrativa, e a parte 1 dele usa os números antigos do Taquari.

### 8. Revisar os textos em inglês com alguém fluente (Laís, antes da submissão)

- **Onde:** `apps/web/src/i18n/en.ts` (interface) e os textos em inglês de `packages/contract/src/fixtures/scenes.ts` (cenas, critérios, fontes, método da água, leituras do rio). Os da fixture passaram em 14/11 por uma conferência automática contra o português (grafia americana, quatro acertos); falta a leitura de uma pessoa e a interface inteira.
- **Pronto quando:** os dois arquivos foram lidos e o que mudou de sentido foi acertado também em `pt.ts` e no português da fixture.

### 15. Conferir os termos de uso do Esri World Imagery (dono a definir, antes da submissão)

- O detalhe de perto do globo (acima do zoom 8) vem do Esri World Imagery (`apps/web/src/lib/tiles.ts`); o resto do fundo é da NASA (GIBS).
- **Pronto quando:** os termos permitem o uso na demo e na página do projeto e o crédito pedido está no mapa e no `README.md`; se não permitirem, o detalhe sai.

## Se sobrar tempo no domingo de manhã

### 9. Painel "How it works" no app (Gabriel)

- Portar as simulações do explicador (compressão de pulso e anéis de 12 cm), em inglês e português, com `reduceMotion()` e o design do app. Só depois dos itens de antes do congelamento.

### 11. Hidrograma do Taquari (Gabriel)

- **O quê:** no detalhe do Taquari, gráfico da água aberta nova em cada passagem do NISAR, com a cheia de 22/07 marcada.
- **Dado:** `scene.waterSeries` (uma amostra por passagem, com a faixa, e o texto do método) e `scene.riverGauge` (leituras do nível do rio: lugar, hora, se subia ou descia, cota de alagamento quando a fonte dá, e a fonte); ver `types.ts`. Opcionais, só no Taquari, iguais em `mock` e `http`: são medidas e fontes reais nos dois modos.
- **Tela:** SVG no molde do `Timeline` de `PassesPanel.tsx`: um marcador por passagem (ascendente `--blue`, descendente `--ink`), haste de `lowKm2` a `highKm2`, marcador vazado quando `reference`, linha só dentro da mesma órbita e sem atravessar mais de 12 dias, uma linha vertical por dia de leitura do rio (nível, lugar, fonte), `method` na legenda.
- **Cuidados:** o "km² changed" do mapa de mudança é outra medida: não juntar nem somar. O número do detalhe sai da amostra de 23/07, com o rótulo "New water" / "Água nova", e não vai para `areaKm2`.
- **Pronto quando:** pontos montados por função testada em `lib/`, textos nos dois idiomas, nada aparece em cena sem os campos, tela conferida (também estreita).

### 20. Cores do mapa fora dos tokens (Gabriel)

- A constante `C` de `MapView.tsx` ficou com o vermelho e o azul de antes do redesenho (`#FC3D21`, `#4C8DFF`); os tokens de `:root` em `styles.css` hoje são `--red: #f04a2a` e `--blue: #5b8cff`. O tracejado vermelho e a faixa da órbita ascendente, que o mapa desenha com `C`, saem num tom diferente do resto da tela, e a regra do Design no `CLAUDE.md` pede que `C` repita os tokens. O `#4C8DFF` também é o meio da escala do interferograma (`COLORS` em `scripts/gunw_crop.py`), gravado nas imagens.
- **Pronto quando:** `C` repete os tokens, ou a regra do `CLAUDE.md` passa a dizer que o mapa tem tons próprios.

### 21. Laboratório do radar: alinhar com os dados calibrados (Gabriel)

- Só vale nesta branch (`claude/youthful-keller-mp9zju`), que tem o laboratório (`?lab=hydro|pulse|fringes`), o redesenho em vidro e a busca com todas as cidades, e recebeu a `main` em 14/11.
- **Régua de cheia:** feito em 14/11. `Hydrograph.tsx` lê `scene.waterSeries` e `scene.riverGauge` (cerca de 53 km² no pico); o campo `hydrograph`, medido no preview, saiu do contrato e virou `floodContext`, só com chuva, vazão modelada, dias ópticos e OPERA. Cobre o item 11 nesta branch. Falta: em tela estreita a legenda do gráfico rola junto com ele, e a captura `docs/preview-regua-cheia.jpg` do README foi refeita só em inglês.
- **Régua de franjas:** feito em 14/11. `FringeLab.tsx` conta as franjas entre as duas pontas e diz quanto vale uma (cerca de 12,1 cm de mudança na distância até o satélite, o `cycleCm` da cena `laguaira`); não soma centímetros nem diz para que lado o chão andou, e saiu a citação da UC San Diego, que ninguém conferiu. Continua com imagens próprias (`apps/web/src/assets/insar`, preview da trilha 162, sem nada descontado), e a tela avisa: a cena `laguaira` da API guarda a fase dobrada em tons de cinza, o que não serve para somar ao longo de uma linha, e só existe com a API. O valor de 12,1 cm foi copiado da cena, do mesmo modo de aquisição; o `insar_fringes.py` não lê a frequência do preview. A tela dessa cena no mapa segue no item 13.
- **Fontes, ressalvas e origem das imagens (era o item 12):** feito nesta branch em 14/11, na folha da cena e na legenda do divisor, com as três frases da fixture movidas e o selo de exemplo falando em duas enchentes. Na `main` o item segue aberto: o front de lá ainda não mostra esses campos.
- **Textos que dizem mais do que o app mostra (era o item 19):** feito nesta branch em 14/11. Com o botão Agora ligado e uma cena de fora das Américas aberta, a legenda diz que ali não há nuvens ao vivo (`inGoesEastView`, em `lib/tiles.ts`, a mesma faixa que gira o globo). "Desmatamento" saiu de `intro.body`; neste redesenho a abertura já usa outro texto, então a troca só aparece na `main`, onde o item segue aberto. O item 9 (painel "How it works") está feito nesta branch, na aba Inside the pulse.
- **Mapa de mudança nas cenas calibradas (era o item 17):** feito nesta branch em 14/11. Com `imagery: "gcov"` o `lib/change.ts` não desconta a mediana, e a tela pinta e mede em separado o que escureceu e o que clareou, sem somar. Taquari: cerca de 60 km² mais escuros em 1,25× e 42 em 1,5×. Chókwè: cerca de 173 km² mais escuros e 3.450 mais claros (antes, 780 km² misturados). Nas cenas sazonais a cena inteira muda com a estação e o lado que muda cobre quase tudo (Maceió, Campo de Gelo Sul): é o que o dado calibrado diz, mas vale conferir se é o que queremos mostrar.
- **Tela do interferograma de La Guaira (era o item 13):** feito nesta branch em 14/11. O front pede `include=interferogram` e mostra a cena com os dois pares, a legenda da fase (12,1 cm por volta de cor) e sem km²; o pacote de imagens do globo foi gerado de novo com ela. Só existe com a API: no modo de exemplo a cena não aparece.
- **Tela reorganizada:** feito nesta branch em 15/11, depois de conferido num preview. Carrossel com os eventos documentados na frente e sem nota no cartão; folha da cena em seções, com uma atividade guiada para a turma (nível Aula) e a aba Medir, com histograma e limiar que se arrasta (nível Dados); o ranking virou uma seção do nível Dados; cada aba do laboratório abre numa parte só. Falta conferir em tela estreita com calma (a simulação do pulso ainda tem umas duas telas de altura) e alguém fluente ler os textos novos em inglês.
- **Inglês revisado em 15/11:** um segundo leitor leu `i18n/en.ts` e os textos em inglês das cenas e apontou 57 itens; quase todos foram aplicados (erros, grafia britânica, frases com cara de tradução e frases que podiam enganar). Ficaram para o time: "flood level" ou "flood stage" nos textos das cenas, e "through frequency" no laboratório. A dica do HH e o glossário diziam que o sinal volta forte da água; saiu a água, nos dois idiomas (o Mateus confirma). Continua valendo a leitura de alguém fluente no que entra no vídeo e na página (item 8).
- **Ranking fora da tela, régua de cheia no topo e setas no carrossel:** feito em 15/11.
- **Pronto quando:** nenhum número do preview aparece na tela (a régua de cheia já não tem; a de franjas só conta franjas), tipos e testes passam e as três abas foram conferidas nos dois idiomas.

### 22. Série mais longa no Taquari: rodar o script (Mateus)

- **O quê:** o Taquari com quatro passagens da mesma órbita (17/06, 29/06, 11/07 e 23/07/2026), para o botão de tocar mostrar a cheia chegando.
- **Já feito, nesta branch:** `SCENES` tem as duas datas em `earlier`; `gcov_crop.py` acha as granules no catálogo (conferido em 14/11: as duas existem na órbita 053_D_103), recorta e grava `earlier-<data>-<POL>.png` e a lista no manifest; a API serve a série (com teste) e a tela foi conferida com quatro passagens simuladas.
- **Falta:** rodar `gcov_crop.py taquari` com o `EARTHDATA_TOKEN` (comando no cabeçalho do script; umas quatro datas de 40 s a 3,5 min) e commitar as imagens e o manifest. O trecho novo do script que recorta as datas anteriores nunca rodou de verdade: quem editou não tinha o token. Conferir os PNGs e a parte válida (`validPct` passa a contar as quatro datas).
- **Cuidados:** a cena passa a abrir em 17/06 contra 23/07; se a demo quiser 11/07 contra 23/07, o link leva `steps=2,3`. Só datas da mesma órbita.
- **Pronto quando:** `GET /api/scenes` devolve quatro passagens no Taquari, o botão de tocar percorre as quatro e os números do `CLAUDE.md` foram conferidos.

## Depois do hackathon

### 16. Notas do ranking medidas (dono a definir)

- As notas das cenas (`scores` na fixture) são inventadas, e os critérios avisam (`isExample`). Dá para medir três delas: tamanho da mudança e área afetada pelo mapa de mudança, passagens disponíveis pela contagem do catálogo (já real em `facts`). "Sinal limpo" precisa de definição.
- **Pronto quando:** as notas saem de um script, `isExample` some dos critérios medidos e o Taquari continua explicável como primeiro da lista.

### 18. Série de água do Taquari depois de 27/07 (Mateus)

- `packages/contract/src/fixtures/taquari-water.json` tem as 21 passagens medidas, até 31/10, mas a cena só publica até 27/07. De agosto em diante a medida sobe aos poucos e não volta ao piso, em manchas com forma de talhão: lavoura alagada ou preparada para o plantio também devolve pouco sinal, e a regra não a separa da água de uma cheia.
- **Para publicar o resto:** separar lavoura de cheia (máscara de uso do solo ou critério de forma) e conferir com as cheias seguintes: o Jornal do Comércio de 06/10/2026 fala em mais três acima de 23 m depois da de julho, e o de 22/09/2026, num pico de 24,46 m em Estrela naquele dia (as duas páginas foram abertas e conferidas em 14/11).

## Descartado

- **Harmony para recortar o GCOV:** a leitura parcial por HTTP do `gcov_crop.py` já faz isso.
- **NISAR do GIBS ao vivo (plano D):** telhas quebradas e dependência de rede na demo.
- **Copiar o `scenes.real.json` do handoff inteiro:** as cenas já têm datas, órbitas e imagens reais, e os campos que valiam a pena (fontes, ressalva, série de água e nível do rio) já entraram no contrato.
