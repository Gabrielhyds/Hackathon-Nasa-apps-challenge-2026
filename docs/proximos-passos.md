# Próximos passos

Lista única do que falta no Nexxus, para trabalhar em paralelo. Cada item diz quem faz, onde mexer e quando está pronto, para qualquer pessoa ou agente pegar sem precisar da conversa em que surgiu. Leia junto com o `CLAUDE.md`.

Pegou um item: escreva seu nome nele e commite, para ninguém fazer duas vezes. Terminou: apague o item (o histórico do git guarda) e, se mudou algo que vale para todos, registre no `CLAUDE.md`. Ideia nova entra aqui. Funcionalidades congelam domingo às 15h.

Parte destas ideias vem do explicador "Radar, Fourier e franjas" (protótipo em português do Mateus: através das nuvens, compressão de pulso, régua de 12 cm, Fourier alinhando as imagens) e do pacote `nexxus-handoff` (`HANDOFF.md` e o doc "Nexxus: planos para o hackathon"), que não estão no repositório: peça ao Mateus.

## Números do Taquari

Os números atuais estão só no `CLAUDE.md` (O que ainda é exemplo, Imagens de radar): a água aberta nova medida no GCOV em 23/07/2026, com a faixa, sem citar total de água nem área alagada. Números antigos que ainda circulam e precisam sair: "57 km²" (roteiro da demo), "46 km² a mais" e "53 km² no total" (explicador), "46,7 km²" (handoff), "51 km², de 41 a 51" (no `CLAUDE.md` até 14/11), "é preview de 8 bits" (linha de riscos do doc de planos).

## Antes do congelamento

### 4. Agente real (Vitor)

Integrado em 15/11: o agente está em `apps/agent`, sobe no Docker e a aba Ask mostra resposta, ressalva, fontes e cenas citadas (O agente, no `CLAUDE.md`). Falta:

- Pôr `GEMINI_API_KEY` no `.env` da máquina da demo e conferir no navegador uma resposta escrita pelo modelo (a integração foi vista na tela só no modo reserva, sem chave). Em 15/11 entraram oito correções no agente (PRs #7 e #9 a #15), testadas só com modelo simulado: ao conferir, fazer pelo menos uma pergunta com "aqui" numa cena aberta (o modelo agora recebe a linha `OPEN SCENE`), uma sobre outro assunto com cena aberta e uma sobre a Groenlândia (o verificador reprovava "Greenland").
- Gerar e commitar `apps/agent/data/respostas_prontas.json` (`python scripts/aquecer.py`, com a chave), para as perguntas prováveis não gastarem cota.
- O agente não recebe a conversa anterior: pergunta de seguimento ("e por quê?") é respondida sem o contexto. Decidir se vale mandar o histórico.
- Os fatos das cenas existem em dois lugares, a fixture e os cartões. Conferir um contra o outro a cada mudança; o que não bate hoje está no item 24.

### 5. Ambiente público na VM da Azure (Mateus tem o acesso)

- **Como está (15/11):** uma VM da Azure (Ubuntu 24.04, 2 vCPUs, 7,7 GB) serve a `main` com `docker compose up -d --build` em `~/nexxus`: página, API e agente, na porta 80 (`WEB_PORT=80` e `VITE_API_MODE=http` no `.env` de lá). De fora só a 80 responde; a 3000 e a 8090 ficam fechadas. O endereço é o IP da máquina, por HTTP: peça ao Mateus.
- **Atualizar depois de um merge:** na VM, em `~/nexxus`, `git pull` e `sudo docker compose up -d --build` (o Docker lá pede `sudo`).
- **Falta a chave do agente:** `GEMINI_API_KEY` está vazia no `.env` da VM, então a aba Ask responde no modo reserva (item 4).
- **Falta o limite de perguntas, antes de pôr a chave:** o agente conta as perguntas por minuto pelo primeiro endereço de `X-Forwarded-For` (`_client_ip`, em `apps/agent/agent/main.py`), e o nginx repassa o que o visitante mandar nesse cabeçalho (`$proxy_add_x_forwarded_for`, em `apps/web/nginx.conf`): quem troca o valor a cada pedido não é limitado e gasta a cota do modelo. Na VM esse nginx é a ponta, então basta `proxy_set_header X-Forwarded-For $remote_addr;`; com outro proxy na frente, é ele que precisa gravar o endereço real.
- **A decidir:** HTTPS e domínio (hoje o link da submissão seria um IP) e até quando a VM fica ligada, para cobrir o julgamento.
- **Pronto quando:** o link abre de fora da rede do time com as cenas e as imagens reais, `GET /api/health` responde, uma resposta escrita pelo modelo foi vista na tela e o endereço está na submissão.

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

Conferido de novo na manhã de 15/11, contra a `main` depois dos PRs do agente: os pontos acima continuam valendo (os cartões só mudaram na maiúscula inicial de dois textos em inglês). Entram mais estes:

- `nexxus`, `sazonais` e os oito cartões das cenas sazonais: "10 cenas", "oito das dez cenas", "uma das dez cenas". A tela com a API mostra onze: três eventos (Taquari, Chókwè e La Guaira) e oito sazonais. Dizer "dez cenas de brilho e uma de interferograma", ou contar onze.
- `nisar`: "cada faixa imageada tem 242 km de largura". O front desenha e escreve 240 km (`NISAR.swathKm`, em `lib/geo.ts`, e o texto da aba Passes). Escolher um dos dois, com a fonte.
- `taquari_hidrograma`: a conferência viria de "as nuvens vistas pelo MODIS e pelo VIIRS em 22 e 23/07". No app há o MODIS Aqua de 23/07 (modo Sob nuvem) e o HLS de 25/07 (Conferência da régua de cheia); o VIIRS e o dia 22/07 não aparecem em lugar nenhum.
- `dados_nisar`: "VALIDATED … para passagens a partir de 21/10/2026". No `manifest.json`, a passagem de 21/10 do Pantanal está no lote provisório e a de Maceió, do mesmo dia, no validado. Não é contradição do cartão, mas a tela do Pantanal diz "provisória" numa data que o cartão dá como validada.
- **Palavra "copa":** "E quem ganha a Copa?" recebe o cartão `radar_basico`, porque "copa" casa com a copa das árvores. Visto na tela em 15/11, com a cena de La Guaira aberta. Tirar o peso do termo ou tratar "Copa do Mundo" como fora do assunto.
- **Bate, conferido:** 53 km² (49 a 56), 0,3 a 1,6 km² nas referências, 5 km² quatro dias depois e 8 passagens na série (`waterSeries`); 13 passagens de agosto a outubro, de 5 a 27 km² (`taquari-water.json`); pares de 06 a 18/06 e de 18 a 30/06 e cerca de 12 cm por ciclo em La Guaira; lotes BETA em Chókwè e PROVISIONAL no Taquari (`manifest.json`); Campinas, Kalimantan e Lábrea quase sem mudança (visto na tela).
- **Pronto quando:** os cartões batem com a fixture e os testes do agente passam.

## Se sobrar tempo no domingo de manhã

### 20. Cores do mapa fora dos tokens (Gabriel)

- A constante `C` de `MapView.tsx` ficou com o vermelho e o azul de antes do redesenho (`#FC3D21`, `#4C8DFF`); os tokens de `:root` em `styles.css` hoje são `--red: #f04a2a` e `--blue: #5b8cff`. O tracejado vermelho e a faixa da órbita ascendente, que o mapa desenha com `C`, saem num tom diferente do resto da tela, e a regra do Design no `CLAUDE.md` pede que `C` repita os tokens. O `#4C8DFF` também é o meio da escala do interferograma (`COLORS` em `scripts/gunw_crop.py`), gravado nas imagens.
- **Pronto quando:** `C` repete os tokens, ou a regra do `CLAUDE.md` passa a dizer que o mapa tem tons próprios.

### 21. Laboratório e tela nova: o que ficou (Gabriel)

- O laboratório, o redesenho e a tela reorganizada estão na `main` e descritos no `CLAUDE.md` (Estrutura e O laboratório). Ficou:
- **Tela estreita:** a legenda do gráfico da régua de cheia rola junto com ele e a simulação do pulso tem umas duas telas de altura.
- **Captura do README:** `docs/preview-regua-cheia.jpg` foi refeita só em inglês.
- **Inglês:** "flood level" ou "flood stage" nos textos das cenas e "through frequency" no laboratório, para o time decidir; a leitura de alguém fluente segue no item 8.
- **Cenas sazonais no mapa de mudança:** o lado que muda cobre quase toda a cena em Maceió (cerca de 1.430 km² mais escuros) e no Campo de Gelo Sul (cerca de 1.980 km²), em 1,25× e HH, vistos na tela em 15/11. É o que o dado calibrado diz; decidir se é o que queremos mostrar.
- **Pronto quando:** nenhum número do preview aparece na tela (a régua de cheia já não tem; a de franjas só conta franjas), tipos e testes passam e as três abas foram conferidas nos dois idiomas.

## Depois do hackathon

### 16. Notas do ranking medidas (dono a definir)

- As notas das cenas (`scores` na fixture) são inventadas, e os critérios avisam (`isExample`). Dá para medir três delas: tamanho da mudança e área afetada pelo mapa de mudança, passagens disponíveis pela contagem do catálogo (já real em `facts`). "Sinal limpo" precisa de definição.
- **Pronto quando:** as notas saem de um script, `isExample` some dos critérios medidos e o Taquari continua explicável como primeiro da lista.

### 18. Série de água do Taquari depois de 27/07 (Mateus)

- `packages/contract/src/fixtures/taquari-water.json` tem as 21 passagens medidas, até 31/10, mas a cena só publica até 27/07. De agosto em diante a medida sobe aos poucos e não volta ao piso, em manchas com forma de talhão: lavoura alagada ou preparada para o plantio também devolve pouco sinal, e a regra não a separa da água de uma cheia.
- **Para publicar o resto:** separar lavoura de cheia (máscara de uso do solo ou critério de forma) e conferir com as cheias seguintes: o Jornal do Comércio de 06/10/2026 fala em mais três acima de 23 m depois da de julho, e o de 22/09/2026, num pico de 24,46 m em Estrela naquele dia (as duas páginas foram abertas e conferidas em 14/11).

### 27. Agente: o que a auditoria de 15/11 achou e ficou de fora (Vitor)

Reproduzido com modelo simulado, sem a chave do Gemini. Nenhum impede a demo: quando o verificador erra para o lado seguro, a resposta cai no texto do cartão.

- **Verificador, o que passa:** número com a unidade por extenso ("57 square kilometers", "120 quilômetros quadrados"), data em palavras ("March 15", "15 de março"; em inglês os cartões escrevem todas as datas assim, então não há conferência de data), magnitude abreviada ("M 9,9"), número de pessoas atingidas e previsão com outros verbos ("o rio subirá"). Em `apps/agent/agent/guard.py`: `MEASURE`, `DATE`, `MAGNITUDE` e `FORECAST`.
- **Verificador, o que reprova sem motivo:** negações que `NEGATION` não conhece ("cannot", "doesn't", "ninguém"), então "Nexxus cannot say whether the valley will flood again" cai como previsão; "a área alagada real é maior" cai como afirmação de área alagada; "o OPERA usa o Sentinel-1, pelo GIBS da NASA" cai como Sentinel-1 da NASA; qualquer resposta com a palavra "checklist".
- **Etiqueta com dois cartões:** "[nisar, radar_basico]" não é lida por `TAG`: fica visível na resposta e o segundo cartão não entra nas fontes.
- **Respostas prontas saem do cache primeiro:** entram antes de tudo no cache de 300 perguntas (`CACHE_SIZE`) e são as primeiras a ser descartadas quando ele enche; guardar à parte.
- **Idioma sem `lang`:** "Explain a radar pass" é lida como português e "Fale sobre Campinas" como inglês (`PT_HINTS` tem "a", "o", "e", "as", "do"). O app sempre manda `lang`; só afeta a página de teste do agente.
- **`scripts/aquecer.py`** lê `apps/agent/.env`, e a chave fica no `.env` da raiz: conferir antes de rodar (não foi rodado, sem chave).
- **Pronto quando:** cada ponto tem teste em `tests/test_agent.py` e o banco de perguntas continua passando.

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
