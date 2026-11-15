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
- Conteúdo: o radar manda um chirp longo, e o filtro casado (Fourier) junta a energia num pico estreito; o ganho é banda × duração e a resolução é c/2B (40 MHz, cerca de 3,75 m na direção do satélite, em seis das dez cenas de brilho; pelo código do modo no nome da granule, Lábrea, Pantanal e Kalimantan seriam de 20 MHz e Jakobshavn, de 77 MHz: é leitura do nome do arquivo, falta conferir no guia do produto antes de citar). A onda do NISAR tem 24 cm e o caminho é de ida e volta, então cada ciclo de cor de um interferograma vale 12 cm de movimento na direção do satélite; nos terremotos de 24/06/2026, no norte da Venezuela, a NASA mediu até 60 cm de deslocamento para oeste, valor preliminar (NASA Earth Observatory).
- A duração do pulso no explicador é ilustrativa, e a parte 1 dele usa os números antigos do Taquari.

### 8. Revisar os textos em inglês com alguém fluente (Laís, antes da submissão)

- **Onde:** `apps/web/src/i18n/en.ts` (interface) e os textos em inglês de `packages/contract/src/fixtures/scenes.ts` (cenas, critérios, fontes, método da água, leituras do rio). Os da fixture passaram em 14/11 por uma conferência automática contra o português (grafia americana, quatro acertos); falta a leitura de uma pessoa e a interface inteira.
- **Pronto quando:** os dois arquivos foram lidos e o que mudou de sentido foi acertado também em `pt.ts` e no português da fixture.

### 15. Conferir os termos de uso do Esri World Imagery (dono a definir, antes da submissão)

- O detalhe de perto do globo (acima do zoom 8) vem do Esri World Imagery (`apps/web/src/lib/tiles.ts`); o resto do fundo é da NASA (GIBS).
- **Pronto quando:** os termos permitem o uso na demo e na página do projeto e o crédito pedido está no mapa e no `README.md`; se não permitirem, o detalhe sai.

### 23. Textos e detalhes de tela vistos no ensaio de 15/11 (Gabriel)

Vistos na tela com o Docker normal, na madrugada de 15/11. São pequenos e independentes.

- **La Guaira, nível Dados, seção Origem:** aparece "No data on one of the dates: 50.0% of the crop, drawn black" (`originMissing` e `originMissingValue`, em `SceneSheet.tsx`, linha 221). Na cena de interferograma os vazios são transparentes e são água ou sinal perdido num dos pares, como a legenda do divisor já diz. Esconder a linha quando `isInterferogram`, ou dar a ela o texto da legenda. Ver em `?scene=laguaira&aud=analyze`, seção Origem.
- **La Guaira, nível Dados, seção História:** o botão "Measure the change" leva à seção Medir, que nessa cena não mede nada (explica a fase). Trocar o rótulo ou tirar o botão nessa cena.
- **Pulso, "The sent pulse":** "a sweep of 25 µs, 3.7 km long on the ground" (`sentNote`, em `en.ts` e `pt.ts`). c·T/2 é o comprimento do pulso na direção do satélite, não no chão; o cartão ao lado já diz "along the line of sight". Usar o mesmo termo nos dois idiomas.
- **Régua de cheia, "78% cloud":** a conta do `scripts/hydrograph.py` é nuvem ou sombra de nuvem (o cinza da máscara do HLS). Dizer "cloud or cloud shadow" / "nuvem ou sombra", nos três textos de `i18n` que mostram a porcentagem.
- **Régua de cheia em tela estreita:** o gráfico tem 760 px e rola de lado dentro de `.hydro__chart`; abre no começo da série (junho), com o pico de 23/07 fora da tela. Visto em 375 px, em `?lab=hydro&lang=pt`. Abrir rolado até o pico.
- **Pronto quando:** os cinco pontos foram vistos na tela, nos dois idiomas.

### 24. Cartões do agente contra a fixture e a tela (Vitor)

Conferido em 15/11, cartão por cartão, contra `packages/contract/src/fixtures/scenes.ts`, `scripts/water_series.py` e a tela. Em `apps/agent/data/cards.json`:

- `taquari_hidrograma`: "há uma passagem a cada 6 a 12 dias sobre o vale". Na série publicada é uma a cada 4 ou 8 dias, e é o que a régua de cheia diz.
- `taquari_numeros_antigos` e `limites`: o mapa de mudança "mostra cerca de 63 km²". Na tela, em 1,25× e HH, são cerca de 60 km² mais escuros no par de 11/07 contra 23/07 e cerca de 55 no par de 17/06 contra 23/07, em que a cena passa a abrir com a série de quatro passagens. Dizer o par e a sensibilidade, ou tirar o número.
- `taquari`: "Comparando as passagens de 11/07 e 23/07/2026, o Nexxus mede cerca de 53 km²". A medida compara 23/07 com a referência de águas baixas da mesma órbita, não só com 11/07 (o método está em `waterSeries.method`, na fixture).
- `taquari_metodo`, em inglês: a faixa de 49 a 56 km² viria de "moving those two thresholds". Só o limiar de água se move (−14, −12 e −10 dB, `THRESHOLDS_DB` no script); a queda de 3 dB fica fixa. Conferir também o português.
- `taquari` e `taquari_hidrograma`: a fonte do nível do rio é o Jornal do Comércio de 22/07/2026 ("nível de 24 m em Lajeado"); a fixture usa 24,7 m, do Jornal do Comércio de 06/10/2026, e não tem a página de 22/07. Os números não se contradizem ("passou de 24 m"), mas a ressalva do agente fala em "o nível de 24 m" ao lado de uma cena que diz 24,7 m. Alinhar, e registrar quem abriu a página de 22/07 e quando.
- `chokwe`: a fonte `svs.gsfc.nasa.gov/15087/` e os números de impacto ("mais de 600 mil pessoas, 400 mil acres de lavoura, 30 mil casas") não estão na fixture. Registrar quem abriu a página e quando, ou tirar.
- `sazonais` e os cartões das oito cenas sazonais: "duas passagens, entre junho e novembro de 2026", sem as datas de cada cena (estão em `dates`, na fixture).
- Os cartões do Taquari falam em duas passagens; com a série de quatro (17/06, 29/06, 11/07 e 23/07), rever.
- **Pronto quando:** os cartões batem com a fixture e os testes do agente passam.

## Se sobrar tempo no domingo de manhã

### 20. Cores do mapa fora dos tokens (Gabriel)

- A constante `C` de `MapView.tsx` ficou com o vermelho e o azul de antes do redesenho (`#FC3D21`, `#4C8DFF`); os tokens de `:root` em `styles.css` hoje são `--red: #f04a2a` e `--blue: #5b8cff`. O tracejado vermelho e a faixa da órbita ascendente, que o mapa desenha com `C`, saem num tom diferente do resto da tela, e a regra do Design no `CLAUDE.md` pede que `C` repita os tokens. O `#4C8DFF` também é o meio da escala do interferograma (`COLORS` em `scripts/gunw_crop.py`), gravado nas imagens.
- **Pronto quando:** `C` repete os tokens, ou a regra do `CLAUDE.md` passa a dizer que o mapa tem tons próprios.

### 21. Laboratório e tela nova: o que ficou (Gabriel)

- O laboratório, o redesenho e a tela reorganizada estão na `main` e descritos no `CLAUDE.md` (Estrutura e O laboratório). Ficou:
- **Tela estreita:** a legenda do gráfico da régua de cheia rola junto com ele (ver também o item 23) e a simulação do pulso tem umas duas telas de altura.
- **Captura do README:** `docs/preview-regua-cheia.jpg` foi refeita só em inglês.
- **Inglês:** "flood level" ou "flood stage" nos textos das cenas e "through frequency" no laboratório, para o time decidir; a leitura de alguém fluente segue no item 8.
- **Cenas sazonais no mapa de mudança:** o lado que muda cobre quase toda a cena em Maceió (cerca de 1.430 km² mais escuros) e no Campo de Gelo Sul (cerca de 1.980 km²), em 1,25× e HH, vistos na tela em 15/11. É o que o dado calibrado diz; decidir se é o que queremos mostrar.
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

### 25. Contas do front para rever com calma (Gabriel, com o time)

De uma revisão de leitura do código em 15/11; só o primeiro ponto foi refeito à mão, os outros não foram reproduzidos com número. Nenhum muda antes do congelamento: mexem em números que já estão na tela e nos textos.

- **`lib/change.ts`, `EPS = 0.04`:** é somado às duas amplitudes antes da razão, também no dado calibrado. Em chão escuro isso comprime a mudança: uma queda de −14 para −20 dB (6 dB) é lida como 4,7 dB, e uma queda real de 2× em terra escura pode não passar do limiar de 2×. Vale para todos os km² do mapa de mudança, então trocar a conta muda os números do `CLAUDE.md`, da fixture e dos cartões do agente.
- **`changedParts`:** os pixels sem dado entram na conta. Hoje é desprezível: só Jakobshavn (99,9% com dado) e Pantanal (99,8%) têm parte vazia.
- **`lib/probe.ts`:** faz a média de 3 × 3 pixels antes de testar cinza 0 e 255, e a média é da amplitude, não da potência.
- **`lib/pulse.ts`, `measuredOutputSnrDb`:** o pico é o máximo global, então com eco muito fraco a medida não desce de uns 9 dB; e a guarda de `pulseSamples / 8` deixa lóbulos do chirp dentro do "ruído", então com eco forte a medida fica abaixo da teórica.
- **`lib/fringes.ts`:** janela vazia zera a fase anterior, `Math.round` de ±0,5 é assimétrico e pontos fora da imagem inflam a coerência.
- **Aba Medir:** a cor de cada barra do histograma sai do centro da barra contra o limiar, e a barra que o limiar corta fica de uma cor só.

### 26. Scripts: acertos que pedem gerar os dados de novo (Mateus)

Da mesma revisão de 15/11, por leitura. Nenhum muda o que a demo mostra.

- `places_data.py`: `by_code[gn_a1_code]` é sobrescrito onde o Natural Earth é mais fino que o nível 1 do GeoNames (França, Reino Unido), o que também impede a busca pelo polígono mais próximo; o centro de BQ e de SJ sai da média das ilhas e cai no mar.
- `hydrograph.py`: `waterKm2` divide por todos os pixels, com ou sem dado (até 2% de viés); a chuva está em hora local e a vazão e os satélites em UTC; `wms()` devolve `None` em silêncio quando a rede falha; a miniatura óptica usa só o S30; miniaturas da mesma data se sobrescrevem.
- `insar_fringes.py`: o `bbox` sai dos pixels válidos e difere um pouco entre os dois pares.
- `optical_day.py`: trata luminância abaixo de 4 no JPEG como sem dado.
- `scene_images.py`: o comentário de `SCENES` "datas da escolha automática 6" está truncado desde o primeiro commit.

## Descartado

- **Harmony para recortar o GCOV:** a leitura parcial por HTTP do `gcov_crop.py` já faz isso.
- **NISAR do GIBS ao vivo (plano D):** telhas quebradas e dependência de rede na demo.
- **Copiar o `scenes.real.json` do handoff inteiro:** as cenas já têm datas, órbitas e imagens reais, e os campos que valiam a pena (fontes, ressalva, série de água e nível do rio) já entraram no contrato.
