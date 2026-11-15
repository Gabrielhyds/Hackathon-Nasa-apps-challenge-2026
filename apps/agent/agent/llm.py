"""Chamada ao Gemini. Se não houver chave ou der erro, quem chama usa o modo reserva."""
from __future__ import annotations

import asyncio
import logging
import os
import time
from collections import defaultdict, deque

log = logging.getLogger("nexxus.llm")

# Medido em 15/11/2026 com a chave do time, na mesma pergunta:
#   gemini-3.5-flash-lite  0,8 s, resposta limpa     <- padrão
#   gemini-3.1-flash-lite  6,1 s, resposta limpa
#   gemini-3.5-flash       7,6 s, resposta cortada no meio (o raciocínio come os tokens)
#   gemini-3.6-flash      15,1 s, vazou o raciocínio na resposta
#   gemini-3.7 e 3.8-flash  503, "high demand"
#   gemini-2.5-flash        404, "no longer available to new users"
MODEL = os.getenv("GEMINI_MODEL", "gemini-3.5-flash-lite")
# Se o modelo configurado sumir ou lotar no meio do evento, tenta o seguinte da fila.
FALLBACKS = list(dict.fromkeys(
    m for m in (MODEL, "gemini-3.5-flash-lite", "gemini-3.1-flash-lite", "gemini-3.5-flash") if m
))
# 8 s por tentativa: o flash-lite responde em cerca de 1 s, e na demo é melhor cair para o
# texto do cartão depois de 8 s do que deixar o jurado olhando um campo parado.
TIMEOUT_S = float(os.getenv("LLM_TIMEOUT_S", "8"))
# Teto somando todas as tentativas, para a fila de modelos não virar uma espera longa.
BUDGET_S = float(os.getenv("LLM_BUDGET_S", "15"))
MAX_TOKENS = int(os.getenv("LLM_MAX_TOKENS", "900"))
# A chave gratuita do AI Studio dá 15 pedidos por minuto por modelo. Guardamos uma folga e
# contamos em casa: estourar a cota custa uma ida à rede e volta sem resposta.
RPM = int(os.getenv("GEMINI_RPM", "12"))
PAUSA_POS_429_S = float(os.getenv("GEMINI_PAUSA_429_S", "45"))

_chamadas: dict[str, deque] = defaultdict(deque)
_bloqueado_ate: dict[str, float] = {}

_client = None
_active: str | None = None


def available() -> bool:
    return bool(os.getenv("GEMINI_API_KEY") or os.getenv("GOOGLE_GENAI_USE_VERTEXAI"))


def _get_client():
    global _client
    if _client is None:
        from google import genai  # importa só quando precisa

        # Com GEMINI_API_KEY usa a API do Gemini; com GOOGLE_GENAI_USE_VERTEXAI=true
        # (mais GOOGLE_CLOUD_PROJECT e GOOGLE_CLOUD_LOCATION) usa o Vertex AI pela conta de serviço do Cloud Run.
        _client = genai.Client()
    return _client


def _tem_cota(nome: str) -> bool:
    """Deixa chamar o modelo só se ele não levou 429 agora e ainda cabe no minuto."""
    agora = time.monotonic()
    if _bloqueado_ate.get(nome, 0) > agora:
        return False
    fila = _chamadas[nome]
    while fila and agora - fila[0] > 60:
        fila.popleft()
    return len(fila) < RPM


def _marcar(nome: str) -> None:
    _chamadas[nome].append(time.monotonic())


def _sem_cota(exc: Exception) -> bool:
    texto = str(exc)
    return "429" in texto or "RESOURCE_EXHAUSTED" in texto


def _try_next(exc: Exception) -> bool:
    """Modelo que não existe (404), que está lotado (503), sem cota (429) ou que não respondeu a tempo: tenta o próximo."""
    # O tempo esgotado não traz texto nenhum (str(TimeoutError()) é ""), então não casa com os códigos abaixo.
    if isinstance(exc, (asyncio.TimeoutError, TimeoutError)):
        return True
    texto = str(exc)
    return any(c in texto for c in ("404", "NOT_FOUND", "503", "UNAVAILABLE", "429", "RESOURCE_EXHAUSTED"))


async def generate(system_prompt: str, user_content: str) -> str:
    from google.genai import types

    global _active
    client = _get_client()
    base = dict(system_instruction=system_prompt, temperature=0.2, max_output_tokens=MAX_TOKENS)
    simples = types.GenerateContentConfig(**base)
    # Desligar o raciocínio deixa a resposta mais rápida e evita que ela saia cortada, mas o
    # flash-lite recusa a opção com 400. Só tenta se GEMINI_THINKING=0 estiver pedindo.
    tentativas = [simples]
    if os.getenv("GEMINI_THINKING") == "0":
        tentativas.insert(0, types.GenerateContentConfig(
            thinking_config=types.ThinkingConfig(thinking_budget=0), **base))

    # Começa pelo modelo que já respondeu, mas segue para os outros se ele falhar:
    # cada modelo tem a sua própria cota por minuto.
    fila = list(dict.fromkeys(([_active] if _active else []) + FALLBACKS))
    livres = [n for n in fila if _tem_cota(n)]
    if not livres:
        raise RuntimeError("cota por minuto esgotada em todos os modelos")
    erro: Exception | None = None
    comeco = time.monotonic()
    for nome in livres:
        if time.monotonic() - comeco > BUDGET_S:
            log.warning("tempo esgotado antes de tentar %s", nome)
            break
        _marcar(nome)
        for cfg in tentativas:
            try:
                resp = await asyncio.wait_for(
                    client.aio.models.generate_content(model=nome, contents=user_content, config=cfg),
                    timeout=TIMEOUT_S,
                )
                erro = None
                break
            except Exception as exc:
                erro = exc
                # Modelo que não aceita desligar o raciocínio: repete sem essa opção.
                if cfg is not tentativas[-1] and ("thinking" in str(exc).lower() or "400" in str(exc)):
                    continue
                break
        if erro is not None:
            if _sem_cota(erro):
                _bloqueado_ate[nome] = time.monotonic() + PAUSA_POS_429_S
                log.warning("modelo %s sem cota, em pausa por %.0f s", nome, PAUSA_POS_429_S)
            if _try_next(erro) and nome != livres[-1]:
                log.warning("modelo %s indisponível (%s), tentando o próximo", nome, type(erro).__name__)
                continue
            raise erro
        text = (resp.text or "").strip()
        if not text:
            raise RuntimeError("resposta vazia do modelo")
        if _active != nome:
            log.info("usando o modelo %s", nome)
            _active = nome
        return text
    raise erro or RuntimeError("nenhum modelo respondeu")
