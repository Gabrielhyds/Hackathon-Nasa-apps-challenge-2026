# Nexxus · Mission Guide (agente)

Assistente que responde perguntas sobre as cenas do Nexxus em palavras simples, sempre com fonte e ressalva.

No Nexxus ele é o serviço `agent` do Docker Compose da raiz e atende a aba Ask por trás da API (`apps/api/src/agent-context.ts` traduz o pedido e a resposta). A chave do Gemini vai no `.env` da raiz, como `AGENT_API_KEY` (o compose a entrega aqui como `GEMINI_API_KEY`), nunca neste diretório. Ver O agente, no `CLAUDE.md` da raiz.

## Como ele garante respostas certas

1. **Busca** os cartões certos em `data/cards.json` (28 cartões, fatos conferidos em 15/11/2026, em português e inglês). A busca pesa palavra-chave, título e texto, e dá mais peso a termo raro: "Campinas mudou entre as passagens?" vai para a cena de Campinas, não para a aba Passes.
2. **Pergunta ao Gemini** só com esses cartões. O prompt (`agent/prompt.py`) manda usar palavras simples, tom de briefing da NASA, responder na primeira frase, citar o cartão em cada frase e dizer quem mediu o quê (time ou NASA).
3. **Confere a resposta** (`agent/guard.py`). Reprova quando a resposta:
   - usa número proibido (57, 46,7, 45,6, 780 km²; 63 km² só junto de "mapa de mudança");
   - escreve medida, data, magnitude ou ano que não está nos cartões usados;
   - diz que os 53 km² são a área alagada total;
   - diz para que lado o chão andou sem creditar à NASA;
   - faz previsão do que vai acontecer;
   - chama o Sentinel-1 (ESA) de satélite da NASA;
   - vaza rascunho ou o próprio contexto ("Rule Check", "CARDS:");
   - fala de outra cena quando o front diz qual está aberta (`scene`).
   Links escritos pelo modelo são apagados.
4. **Fontes e ressalvas são coladas pelo servidor**, a partir dos cartões. O modelo não consegue inventar link nem esquecer a ressalva.
5. **Respostas prontas:** as perguntas mais prováveis já vêm respondidas em `data/respostas_prontas.json` (geradas por `scripts/aquecer.py`) e entram no cache ao subir o servidor. Elas não gastam cota do modelo.
6. **Modo reserva:** sem chave, sem rede, modelo lento (8 s por tentativa, 15 s no total), cota estourada ou resposta reprovada → responde com as frases do próprio cartão que falam da pergunta. A aba Ask nunca fica muda.

Pergunta fora do assunto → "O Nexxus não tem essa informação" e a lista do que ele sabe.

## O que ele sabe

| Cartão | Assunto |
|---|---|
| `taquari`, `taquari_metodo`, `taquari_hidrograma`, `taquari_numeros_antigos` | a cheia de 22/07/2026, como os 53 km² foram medidos, o hidrograma de radar, por que os números antigos saíram |
| `limites` | o que a medida não vê, lavoura que parece água, e que o Nexxus não faz previsão |
| `chokwe`, `venezuela` | as outras cenas com evento documentado, com base, fonte e ressalva |
| `sazonais` + um cartão por cena (`sindh`, `labrea`, `jakobshavn`, `pantanal`, `kalimantan`, `campo_de_gelo_sul`, `campinas`, `maceio`) | as oito cenas sazonais: cada uma responde pelo seu lugar, sem herdar fato de outra |
| `nisar`, `radar_basico`, `fourier`, `interferometria` | o satélite, como o radar vê água, compressão de pulso e Fourier, franjas e 12 cm por ciclo |
| `dados_nisar`, `passagens`, `outras_fontes`, `parceiros`, `aprender_sar` | maturidade BETA/PROVISIONAL/VALIDATED, catálogo CMR, GIBS e OPERA, RADARSAT e SAOCOM, material oficial de SAR |
| `ranking`, `nexxus`, `uso_ia` | aviso das notas de exemplo, o projeto, uso de IA |

## Rodar local

```bash
pip install -r requirements.txt
uvicorn agent.main:app --port 8080        # modo reserva
GEMINI_API_KEY=... uvicorn agent.main:app --port 8080   # com o modelo
```

Abra http://localhost:8080 (página de teste). O seletor **PT / EN** no topo troca a interface e o idioma das respostas; a escolha fica salva no navegador. Para abrir já num idioma: `?lang=pt` ou `?lang=en`. Sem escolha, a página segue o idioma do navegador. Testes: `pytest -q` (83 testes, inclui as 56 perguntas de `tests/perguntas.json`).

## API

`POST /api/ask` com `{"question": "...", "lang": "pt|en" (opcional), "scene": "taquari" (opcional)}`

Resposta: `answer`, `caveats[]`, `sources[{nome,url}]`, `cards[]`, `lang`, `mode` (`model`, `offline`, `no_info`) e `text` (tudo junto, pronto para mostrar).

`GET /api/health` → `{"ok": true, "model": "gemini-3.5-flash-lite" | null, "cards": 28}`

Para a aba Ask do front: chame `POST /api/ask` e mostre `answer`, depois `caveats` e `sources`. Passe `scene` com a cena aberta e `lang` com o idioma escolhido no app; sem `lang`, o agente detecta pelo texto da pergunta. O `scene` pode ser o id de qualquer uma das 10 cenas (`taquari`, `chokwe`, `venezuela`, `pantanal`, `campinas`, `maceio`, `sindh`, `labrea`, `jakobshavn`, `kalimantan`, `campo_de_gelo_sul`): o mapa está em `SCENE_CARDS`, em `agent/knowledge.py`, e o nome que o agente usa para a cena está em `SCENE_LABELS`. Com `scene`, a resposta que falar de outra cena é reprovada.

## Modelo e cota (medido em 15/11/2026 com a chave do time)

| Modelo | Tempo | Resultado |
|---|---|---|
| `gemini-3.5-flash-lite` | 0,8 s | resposta limpa — **padrão** |
| `gemini-3.1-flash-lite` | 6,1 s | resposta limpa |
| `gemini-3.5-flash` | 7,6 s | resposta cortada no meio (o raciocínio come os tokens) |
| `gemini-3.6-flash` | 15,1 s | vazou o raciocínio na resposta |
| `gemini-3.7-flash`, `gemini-3.8-flash` | — | 503, "high demand" |
| `gemini-2.5-flash` | — | 404, "no longer available to new users" |

**A chave está na camada gratuita: 15 pedidos por minuto por modelo** (5 no `3.8-flash`). O plano é seguir assim, sem Vertex AI, com três folgas somadas:

1. **Respostas prontas.** `python scripts/aquecer.py` gera `data/respostas_prontas.json` com as perguntas do banco e as de cada cena, já conferidas. O servidor carrega no cache ao subir, e o `/api/health` mostra quantas são. Essas perguntas respondem na hora e **não gastam cota**. Rode de novo a cada mudança em `data/cards.json`.
2. **Conta em casa.** O agente só chama o modelo se couber em `GEMINI_RPM` pedidos por minuto (12, com folga sobre os 15). Estourou? Vai direto para o modo reserva, sem gastar uma ida à rede. Se mesmo assim vier um 429, aquele modelo fica de molho por `GEMINI_PAUSA_429_S` segundos.
3. **Fila de modelos.** Cada modelo tem a sua própria cota por minuto, então 404, 503 ou 429 fazem o agente passar para o próximo da fila em `agent/llm.py` (`flash-lite` → `3.1-flash-lite` → `3.5-flash`). Na prática, o teto por minuto soma.
- `aiohttp>=3.11` é obrigatório: com a versão antiga o erro de rede virava `AttributeError` e escondia a causa.

## Deploy no Cloud Run

```bash
gcloud run deploy nexxus-agent --source . --region southamerica-east1 \
  --allow-unauthenticated --min-instances 1 --max-instances 3 \
  --set-env-vars GEMINI_MODEL=gemini-3.5-flash-lite,ALLOWED_ORIGINS=https://nexxus.earth \
  --set-secrets GEMINI_API_KEY=gemini-api-key:latest
```

- `--allow-unauthenticated`: qualquer pessoa acessa, sem login.
- `--min-instances 1`: sem espera de "partida a frio" na hora da demo e do julgamento.
- A chave entra como segredo (Secret Manager ou Doppler → variável). **Nunca** em `VITE_*` nem no front.
- Alternativa sem chave, se um dia o Vertex AI estiver disponível: `GOOGLE_GENAI_USE_VERTEXAI=true`, `GOOGLE_CLOUD_PROJECT`, `GOOGLE_CLOUD_LOCATION`, usando a conta de serviço do Cloud Run. Hoje o agente roda com a chave do AI Studio.
- `data/respostas_prontas.json` entra na imagem (o `Dockerfile` já copia `data/`): gere o arquivo **antes** do deploy.
- Limite: 20 perguntas por minuto por IP (`RATE_PER_MIN`); respostas repetidas saem do cache.

## Variáveis

| Variável | Padrão | Para quê |
|---|---|---|
| `GEMINI_API_KEY` | — | chave do Gemini; sem ela, modo reserva |
| `GEMINI_MODEL` | `gemini-3.5-flash-lite` | modelo |
| `LLM_TIMEOUT_S` | `8` | tempo máximo de cada tentativa |
| `LLM_BUDGET_S` | `15` | tempo máximo somando as tentativas |
| `LLM_MAX_TOKENS` | `900` | limite de tokens da resposta |
| `GEMINI_THINKING` | — | `0` tenta desligar o raciocínio (o flash-lite recusa com 400) |
| `ALLOWED_ORIGINS` | `*` | domínios do front (CORS) |
| `RATE_PER_MIN` | `20` | perguntas por minuto por IP |
| `GEMINI_RPM` | `12` | quantas chamadas o agente se permite por minuto, por modelo |
| `GEMINI_PAUSA_429_S` | `45` | quanto tempo um modelo fica de molho depois de um 429 |
| `CACHE_SIZE` | `300` | respostas guardadas em memória |

## Atualizar fatos

Edite só `data/cards.json`. Toda medida, data ou ano novo precisa estar no texto ou na ressalva de um cartão, senão o verificador reprova respostas que os usem. Depois rode `python scripts/aquecer.py` (as respostas prontas viram velhas: o servidor avisa no log) e `pytest -q`: os testes conferem que todo cartão tem palavras-chave, texto nos dois idiomas, fonte em `https://` e, nas cenas, ressalva.
