"""Servidor HTTP do agente Nexxus (FastAPI)."""
from __future__ import annotations

import json
import logging
import os
import time
from collections import OrderedDict, defaultdict, deque
from pathlib import Path

from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field

from . import llm
from .core import CARDS, ask
from .knowledge import detect_lang, norm

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")
log = logging.getLogger("nexxus.main")

RAIZ = Path(__file__).resolve().parent.parent
STATIC = RAIZ / "static"
# Respostas geradas antes do evento (scripts/aquecer.py). Entram no cache ao subir o servidor,
# então as perguntas mais prováveis não gastam cota do modelo durante a demo.
PRONTAS = RAIZ / "data" / "respostas_prontas.json"
RATE_PER_MIN = int(os.getenv("RATE_PER_MIN", "20"))
CACHE_SIZE = int(os.getenv("CACHE_SIZE", "300"))
ORIGINS = [o.strip() for o in os.getenv("ALLOWED_ORIGINS", "*").split(",") if o.strip()]

app = FastAPI(title="Nexxus Agent", version="1.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=ORIGINS,
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["Content-Type"],
)


class AskIn(BaseModel):
    question: str = Field(min_length=1, max_length=500)
    lang: str | None = Field(default=None, pattern="^(pt|en)$")
    scene: str | None = Field(default=None, max_length=40)


_hits: dict[str, deque] = defaultdict(deque)
_cache: OrderedDict[str, dict] = OrderedDict()


def _chave(question: str, lang: str, scene: str | None) -> str:
    return f"{lang}|{scene}|{norm(question).strip()}"


def _carregar_prontas() -> int:
    """Põe no cache as respostas já geradas. Falha em silêncio: é só uma folga de cota."""
    if not PRONTAS.exists():
        return 0
    try:
        dados = json.loads(PRONTAS.read_text(encoding="utf-8"))
    except Exception as exc:  # arquivo torto não pode derrubar o servidor
        log.warning("respostas prontas ignoradas: %s", exc)
        return 0
    # JSON válido com outro formato (lista no lugar do objeto, item sem pergunta) também não derruba:
    # esta função roda quando o módulo é carregado, e uma exceção aqui impede o servidor de subir.
    if not isinstance(dados, dict) or not isinstance(dados.get("respostas", []), list):
        log.warning("respostas prontas ignoradas: formato inesperado")
        return 0
    from .core import CARDS_VERSAO

    if dados.get("cards_versao") and dados["cards_versao"] != CARDS_VERSAO:
        log.warning(
            "respostas prontas são da base %s e a base agora é %s: rode scripts/aquecer.py de novo",
            dados["cards_versao"], CARDS_VERSAO,
        )
    n = 0
    for item in dados.get("respostas", []):
        resposta = item.get("resposta") if isinstance(item, dict) else None
        if not isinstance(resposta, dict) or not isinstance(item.get("question"), str) \
                or resposta.get("lang") not in ("pt", "en") or not isinstance(resposta.get("answer"), str):
            continue
        _cache[_chave(item["question"], resposta["lang"], item.get("scene"))] = resposta
        n += 1
    log.info("%d respostas prontas no cache (modelo %s)", n, dados.get("modelo", "?"))
    return n


def _client_ip(req: Request) -> str:
    fwd = req.headers.get("x-forwarded-for", "")
    return fwd.split(",")[0].strip() if fwd else (req.client.host if req.client else "?")


def _rate_ok(ip: str) -> bool:
    now = time.monotonic()
    q = _hits[ip]
    while q and now - q[0] > 60:
        q.popleft()
    if len(q) >= RATE_PER_MIN:
        return False
    q.append(now)
    return True


PRONTAS_N = _carregar_prontas()


@app.get("/api/health")
def health() -> dict:
    return {
        "ok": True,
        "model": llm.MODEL if llm.available() else None,
        "cards": len(CARDS),
        "prontas": PRONTAS_N,
    }


@app.post("/api/ask")
async def api_ask(body: AskIn, req: Request) -> dict:
    if not _rate_ok(_client_ip(req)):
        raise HTTPException(429, "Muitas perguntas em pouco tempo. Espere um minuto. / Too many questions, wait a minute.")
    # A chave usa o idioma já resolvido: pergunta sem "lang" aproveita a resposta pronta.
    lang = body.lang if body.lang in ("pt", "en") else detect_lang(body.question)
    key = _chave(body.question, lang, body.scene)
    if key in _cache:
        _cache.move_to_end(key)
        return _cache[key]
    result = (await ask(body.question, lang, body.scene)).to_dict()
    if result["mode"] != "offline" or not llm.available():  # não guarda respostas de reserva causadas por falha
        _cache[key] = result
        if len(_cache) > CACHE_SIZE:
            _cache.popitem(last=False)
    return result


@app.get("/")
def index() -> FileResponse:
    return FileResponse(STATIC / "index.html")
