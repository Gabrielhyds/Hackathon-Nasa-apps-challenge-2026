# Próximos passos

Lista única do que falta no Nexxus, para trabalhar em paralelo. Cada item diz quem faz, onde mexer e quando está pronto, para qualquer pessoa ou agente pegar sem precisar da conversa em que surgiu. Leia junto com o `CLAUDE.md`.

Pegou um item: escreva seu nome nele e commite, para ninguém fazer duas vezes. Terminou: apague o item (o histórico do git guarda) e, se mudou algo que vale para todos, registre no `CLAUDE.md`. Ideia nova entra aqui. Funcionalidades congelam domingo às 15h.

Parte destas ideias vem do explicador "Radar, Fourier e franjas" (protótipo em português do Mateus: através das nuvens, compressão de pulso, régua de 12 cm, Fourier alinhando as imagens) e do pacote `nexxus-handoff` (`HANDOFF.md` e o doc "Nexxus: planos para o hackathon"), que não estão no repositório: peça ao Mateus.

## Números do Taquari

Os números atuais estão só no `CLAUDE.md` (O que ainda é exemplo, Imagens de radar): a água aberta nova medida no GCOV em 23/07/2026, com a faixa, sem citar total de água nem área alagada. Números antigos que ainda circulam e precisam sair: "57 km²" (roteiro da demo), "46 km² a mais" e "53 km² no total" (explicador), "46,7 km²" (handoff), "51 km², de 41 a 51" (no `CLAUDE.md` até 14/11), "é preview de 8 bits" (linha de riscos do doc de planos).

## Antes do congelamento

### 4. Agente real (Vitor)

Integrado em 15/11: o agente está em `apps/agent`, sobe no Docker e a aba Ask mostra resposta, ressalva, fontes e cenas citadas (O agente, no `CLAUDE.md`). Conferido e o que ficou:

- Conferido com o modelo em 15/11. As oito correções do agente que entraram no dia (PRs #7 e #9 a #15) têm teste com modelo simulado e foram conferidas com a chave do time: 50 perguntas direto no código (respostas em cerca de 1 s) e, no site público, uma pergunta com "aqui" numa cena aberta (o modelo recebe a linha `OPEN SCENE`), uma sobre outro assunto com cena aberta e uma sobre a Groenlândia (o verificador reprovava "Greenland"). As três voltaram escritas pelo modelo, com as fontes e, quando o cartão tem, a ressalva. A resposta na tela está no item 5.
- `apps/agent/data/respostas_prontas.json` foi gerado em 15/11 com os cartões da versão `2026-11-15c`: 112 respostas do modelo (49 com cena aberta), carregadas ao subir o agente e guardadas à parte do cache, de onde não saem. Mudou um cartão ou a regra de quando a cena vale (`scene_in_focus`), gerar de novo: `python scripts/aquecer.py`, com a chave (ele lê o `.env` da raiz), 114 perguntas em cerca de 13 minutos. "Qual a fonte disso?" e "What is the source?", sem "aqui" nem nome de lugar, dão "não sei" mesmo com uma cena aberta e ficaram de fora.
- O agente não recebe a conversa anterior. Com uma cena aberta, a pergunta de seguimento sem assunto próprio ("E por quê?", "Tell me more") agora é respondida sobre a cena; sem cena aberta continua em "não sei". Decidir se vale mandar o histórico.
- Não há cartão para "para quem serve" e "por que importa" fora de uma cena: "How would a city use Nexxus?" dá "não sei". O texto é da narrativa (Laís).
- O verificador confere números, datas e algumas afirmações, não a prosa: "Por que a imagem de radar é granulada?" voltou com a palavra "sarqueamento" e uma explicação que não está em cartão nenhum. Um cartão curto sobre o granulado resolve esse caso.
- Os fatos das cenas existem em dois lugares, a fixture e os cartões. Conferir um contra o outro a cada mudança. Em 15/11 os cartões foram acertados contra a fixture, o `manifest.json` e a tela (nível do rio de 24,7 m com a fonte da fixture, a referência de águas baixas, as quatro passagens do Taquari, o mapa de mudança com o par e a sensibilidade, as datas de cada cena sazonal, onze cenas, faixa de cerca de 240 km, MODIS e HLS no lugar de MODIS e VIIRS) e conferidos com o modelo em 14 perguntas. As fontes dos cartões `taquari` e `chokwe` foram abertas e conferidas contra o texto dos cartões em 15/11: Jornal do Comércio de 22/07/2026 (cinco municípios acima da cota de inundação, em alerta máximo; o texto depois do primeiro parágrafo é só para assinantes) e de 24/07/2026 (a previsão da noite de 21/07 e a primeira cheia acima da cota desde 2024), `svs.gsfc.nasa.gov/5661` (as passagens de 5 e 17 de janeiro, as cores e os números de impacto, que valem para o sul de Moçambique) e `svs.gsfc.nasa.gov/15087/` (a série do Landsat, sem números de impacto).
- A área do mapa de mudança do Taquari está escrita nos cartões `taquari_numeros_antigos` e `limites` (cerca de 55 e 60 km², em 1,25× e HH) e no verificador (`CHANGE_AREA`, em `apps/agent/agent/guard.py`). Mudou a tela, mudar os dois.

### 5. Ambiente público (Mateus e Gabriel têm o acesso)

- **Como está (15/11):** `https://nexxus.earth` (e `www`) serve a `main`. O domínio passa pela Cloudflare, que fala por HTTPS com a máquina onde `docker compose up -d --build` sobe página, API e agente, com o Caddy na frente (`deploy/vm/Caddyfile`). A chave do Gemini fica só no `.env` de lá e o agente responde com o modelo. Conferido pela Cloudflare em 15/11, por curl: página, `GET /api/health`, cenas, imagem de cena, pacote do globo e a resposta do agente chegando aos poucos; e na tela, no Chrome: a cena do Taquari com o mapa de mudança e uma resposta do agente com ressalva e fontes.
- **Limite de perguntas:** o agente conta por visitante, pelo endereço em `X-Forwarded-For`, e quem grava esse endereço é o Caddy, com o endereço que a Cloudflare informa; o que o visitante escrever nesses cabeçalhos é descartado. Conferido em 15/11: com o `X-Forwarded-For` trocado a cada pedido, a vigésima pergunta do minuto volta 429. As faixas de endereço da Cloudflare estão escritas no Caddyfile (lidas em 15/11): se ela mudar as faixas, atualizar lá.
- **Deploy:** `deploy/vm/deploy.sh`, rodado na máquina por quem tem o acesso. Sem argumento sobe a `main`; com o nome de uma branch, sobe essa branch, para testar antes do merge. O site público mostra o que subiu por último: depois do teste, rodar de novo sem argumento.
- **Acesso, DNS e contingência:** o passo a passo (quem entra e como, os registros de DNS e o que fazer se a Cloudflare der problema) fica fora do repositório, com o Mateus e o Gabriel.
- **A decidir:** até quando a máquina fica ligada, para cobrir o julgamento.
- **Pronto quando:** o link abre no navegador de fora da rede do time (falta conferir: no celular, pelo 4G), com as cenas e as imagens reais, e o endereço está na submissão.

### 6. Números do Taquari nos textos (Laís)

- Roteiro da demo, doc de planos e rascunhos da página do projeto: trocar os números antigos listados acima pelos do `CLAUDE.md`.
- A reportagem do Brasil de Fato de 23/07/2026, fonte das leituras do rio na manhã seguinte à cheia (`riverGauge` na fixture), fala em 1,1 mil pessoas fora de casa, embora o endereço da página diga "11-mil": se o número entrar na narrativa, conferir na página.

### 7. Compressão de pulso e régua de 12 cm na página do projeto e no vídeo (Laís)

- Partes 2 e 3 do explicador, em inglês. Explicam como o radar funciona por dentro e ajudam na categoria Best Use of Science, mas não ajudam a ler as cenas, então não precisam estar no app.
- Conteúdo: o radar manda um chirp longo, e o filtro casado (Fourier) junta a energia num pico estreito; o ganho é banda × duração e a resolução é c/2B (40 MHz, cerca de 3,75 m na direção do satélite, em seis das dez cenas de brilho; pelo código do modo no nome da granule, Lábrea, Pantanal e Kalimantan seriam de 20 MHz e Jakobshavn, de 77 MHz: é leitura do nome do arquivo, falta conferir no guia do produto antes de citar). A onda do NISAR tem 24 cm e o caminho é de ida e volta, então cada ciclo de cor de um interferograma vale 12 cm de movimento na direção do satélite; nos terremotos de 24/06/2026, no norte da Venezuela, a NASA mediu até 60 cm de deslocamento para oeste, valor preliminar (NASA Earth Observatory).
- A duração do pulso no explicador é ilustrativa, e a parte 1 dele usa os números antigos do Taquari.

### 15. Conferir os termos de uso do Esri World Imagery (dono a definir, antes da submissão)

- O detalhe de perto do globo (acima do zoom 8) vem do Esri World Imagery (`apps/web/src/lib/tiles.ts`); o resto do fundo é da NASA (GIBS).
- **Pronto quando:** os termos permitem o uso na demo e na página do projeto e o crédito pedido está no mapa e no `README.md`; se não permitirem, o detalhe sai.

## Se sobrar tempo no domingo de manhã

### 20. Cores do mapa fora dos tokens (Gabriel)

- A constante `C` de `MapView.tsx` ficou com o vermelho e o azul de antes do redesenho (`#FC3D21`, `#4C8DFF`); os tokens de `:root` em `styles.css` hoje são `--red: #f04a2a` e `--blue: #5b8cff`. O tracejado vermelho e a faixa da órbita ascendente, que o mapa desenha com `C`, saem num tom diferente do resto da tela, e a regra do Design no `CLAUDE.md` pede que `C` repita os tokens. O `#4C8DFF` também é o meio da escala do interferograma (`COLORS` em `scripts/gunw_crop.py`), gravado nas imagens.
- **Pronto quando:** `C` repete os tokens, ou a regra do `CLAUDE.md` passa a dizer que o mapa tem tons próprios.

### 21. Laboratório e tela nova: o que ficou (Gabriel)

- O laboratório, o redesenho e a tela reorganizada estão na `main` e descritos no `CLAUDE.md` (Estrutura e O laboratório). Ficou:
- **Tela estreita:** a legenda do gráfico da régua de cheia rola junto com ele e a simulação do pulso tem umas duas telas de altura.
- **Captura do README:** `docs/preview-regua-cheia.jpg` foi refeita só em inglês.
- **Inglês:** "flood level" ou "flood stage" nos textos das cenas e "through frequency" no laboratório, para o time decidir (a Laís, fluente, revisou os textos em inglês da interface e das cenas).
- **Cenas sazonais no mapa de mudança:** o lado que muda cobre quase toda a cena em Maceió (cerca de 1.430 km² mais escuros) e no Campo de Gelo Sul (cerca de 1.980 km²), em 1,25× e HH, vistos na tela em 15/11. É o que o dado calibrado diz; decidir se é o que queremos mostrar.
- **Pronto quando:** nenhum número do preview aparece na tela (a régua de cheia já não tem; a de franjas só conta franjas), tipos e testes passam e as três abas foram conferidas nos dois idiomas.

## Depois do hackathon

### 16. Notas do ranking medidas (dono a definir)

- As notas das cenas (`scores` na fixture) são de exemplo, não medidas, e os critérios avisam (`isExample`); o ranking não aparece na tela. Dá para medir três delas: tamanho da mudança e área afetada pelo mapa de mudança, passagens disponíveis pela contagem do catálogo (já real em `facts`). "Sinal limpo" precisa de definição.
- **Pronto quando:** as notas saem de um script, `isExample` some dos critérios medidos e o Taquari continua explicável como primeiro da lista.

### 18. Série de água do Taquari depois de 27/07 (Mateus)

- `packages/contract/src/fixtures/taquari-water.json` tem as 21 passagens medidas, até 31/10, mas a cena só publica até 27/07. De agosto em diante a medida sobe aos poucos e não volta ao piso, em manchas com forma de talhão: lavoura alagada ou preparada para o plantio também devolve pouco sinal, e a regra não a separa da água de uma cheia.
- **Para publicar o resto:** separar lavoura de cheia (máscara de uso do solo ou critério de forma) e conferir com as cheias seguintes: o Jornal do Comércio de 06/10/2026 fala em mais três acima de 23 m depois da de julho, e o de 22/09/2026, num pico de 24,46 m em Estrela naquele dia (as duas páginas foram abertas e conferidas em 14/11).

### 27. Agente: o que a auditoria de 15/11 achou e ficou de fora (Vitor)

Limites conhecidos do verificador, reproduzidos em teste com modelo simulado. Nenhum impede a demo: quando o verificador erra para o lado seguro, a resposta cai no texto do cartão.

- **Verificador, o que passa:** número com a unidade por extenso ("57 square kilometers", "120 quilômetros quadrados"), data em palavras ("March 15", "15 de março"; em inglês os cartões escrevem todas as datas assim, então não há conferência de data), magnitude abreviada ("M 9,9"), número de pessoas atingidas e previsão com outros verbos ("o rio subirá"). Em `apps/agent/agent/guard.py`: `MEASURE`, `DATE`, `MAGNITUDE` e `FORECAST`.
- **Verificador, o que reprova sem motivo:** negações que `NEGATION` não conhece ("cannot", "doesn't", "ninguém"), então "Nexxus cannot say whether the valley will flood again" cai como previsão; "a área alagada real é maior" cai como afirmação de área alagada; "o OPERA usa o Sentinel-1, pelo GIBS da NASA" cai como Sentinel-1 da NASA; qualquer resposta com a palavra "checklist".
- **Idioma sem `lang`:** "Explain a radar pass" é lida como português e "Fale sobre Campinas" como inglês (`PT_HINTS` tem "a", "o", "e", "as", "do"). O app sempre manda `lang`; só afeta a página de teste do agente.
- **Pronto quando:** cada ponto tem teste em `tests/test_agent.py` e o banco de perguntas continua passando.

### 25. Contas do front para rever com calma (Gabriel, com o time)

Da revisão do código de 15/11. O primeiro ponto foi conferido com números; os outros saíram da leitura do código e pedem um caso que os reproduza antes de mexer. Nenhum muda antes do congelamento: mexem em números que já estão na tela e nos textos.

- **`lib/change.ts`, `EPS = 0.04`:** é somado às duas amplitudes antes da razão, também no dado calibrado. Em chão escuro isso comprime a mudança: uma queda de −14 para −20 dB (6 dB) é lida como 4,7 dB, e uma queda real de 2× em terra escura pode não passar do limiar de 2×. Vale para todos os km² do mapa de mudança, então trocar a conta muda os números do `CLAUDE.md`, da fixture e dos cartões do agente.
- **`changedParts`:** os pixels sem dado entram na conta. Hoje é desprezível: só Jakobshavn (99,9% com dado) e Pantanal (99,8%) têm parte vazia.
- **`lib/probe.ts`:** faz a média de 3 × 3 pixels antes de testar cinza 0 e 255, e a média é da amplitude, não da potência.
- **`lib/pulse.ts`, `measuredOutputSnrDb`:** o pico é o máximo global, então com eco muito fraco a medida não desce de uns 9 dB; e a guarda de `pulseSamples / 8` deixa lóbulos do chirp dentro do "ruído", então com eco forte a medida fica abaixo da teórica.
- **`lib/fringes.ts`:** janela vazia zera a fase anterior, `Math.round` de ±0,5 é assimétrico e pontos fora da imagem inflam a coerência.
- **Aba Medir:** a cor de cada barra do histograma sai do centro da barra contra o limiar, e a barra que o limiar corta fica de uma cor só.

### 26. Scripts: acertos que pedem gerar os dados de novo (Mateus)

Da mesma revisão do código de 15/11. Nenhum muda o que a demo mostra.

- `places_data.py`: `by_code[gn_a1_code]` é sobrescrito onde o Natural Earth é mais fino que o nível 1 do GeoNames (França, Reino Unido), o que também impede a busca pelo polígono mais próximo; o centro de BQ e de SJ sai da média das ilhas e cai no mar.
- `hydrograph.py`: `waterKm2` divide por todos os pixels, com ou sem dado (até 2% de viés); a chuva está em hora local e a vazão e os satélites em UTC; `wms()` devolve `None` em silêncio quando a rede falha; a miniatura óptica usa só o S30; miniaturas da mesma data se sobrescrevem.
- `insar_fringes.py`: o `bbox` sai dos pixels válidos e difere um pouco entre os dois pares.
- `optical_day.py`: trata luminância abaixo de 4 no JPEG como sem dado.
- `scene_images.py`: o comentário de `SCENES` "datas da escolha automática 6" está truncado desde o primeiro commit.

### 28. Voz na aba Ask: o que falta conferir e o que ficou de fora (Mateus)

O botão Ouvir lê a resposta com a voz do navegador (`lib/speech.ts`, `lib/useSpeech.ts`; ver o `CLAUDE.md`). Conferido em 15/11 no Chrome do Windows, em português e em inglês (vozes do Google, pela rede; em português também a voz do sistema): lê até o fim, para ao trocar de aba e a música baixa. O aviso de voz que não responde, a leitura cujo fim se perde e a lista de vozes vazia foram conferidos simulando a falha na página, não com um navegador que falhe de verdade.

- **Falta conferir:** o computador da demo (que vozes ele tem, nos dois idiomas, e sem internet), Mac (a lista de vozes de efeito que `pickVoice` pula ainda não foi conferida num Mac), Edge (vozes naturais), celular (Android e iPhone; se o Android lista ou não as vozes), Firefox e Safari, e a tela com leitor de tela: a resposta que cresce dentro de `aria-live="polite"` pode ser anunciada em pedaços.
- **Ficou de fora:** pergunta por voz (`SpeechRecognition` só existe no Chrome, manda o áudio para o Google e precisa de internet); voz neural igual em toda máquina (Kokoro no navegador: Apache 2.0, tem português do Brasil, mas baixa dezenas de MB na primeira vez); voz do Gemini (cota gratuita de poucos pedidos por dia).
- **Pronto quando:** as conferências acima foram feitas e o que não funcionar está escrito no `CLAUDE.md`.

## Descartado

- **Harmony para recortar o GCOV:** a leitura parcial por HTTP do `gcov_crop.py` já faz isso.
- **NISAR do GIBS ao vivo (plano D):** telhas quebradas e dependência de rede na demo.
- **Copiar o `scenes.real.json` do handoff inteiro:** as cenas já têm datas, órbitas e imagens reais, e os campos que valiam a pena (fontes, ressalva, série de água e nível do rio) já entraram no contrato.
