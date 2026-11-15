"""Fluxo de uma pergunta: buscar cartões, perguntar ao modelo, conferir, montar a resposta."""
from __future__ import annotations

import logging
import re
from dataclasses import asdict, dataclass, field

from . import llm
from .guard import check_answer, cited_ids, clean, collect, wrong_scene
from .knowledge import Card, _terms, detect_lang, load_cards, load_versao, retrieve, scene_in_focus
from .prompt import SYSTEM_PROMPT, build_context

log = logging.getLogger("nexxus.agent")
CARDS = load_cards()
CARDS_VERSAO = load_versao()

TOPICS = {
    "pt": "a enchente do Taquari, a cheia de Chókwè, os terremotos da Venezuela, as cenas sazonais, como o radar funciona, o satélite NISAR e de onde vêm os dados",
    "en": "the Taquari flood, the Chókwè flood, the Venezuela earthquakes, the seasonal scenes, how radar works, the NISAR satellite, and where the data comes from",
}
NO_INFO = {
    "pt": "O Nexxus não tem essa informação. Posso falar sobre {t}.",
    "en": "Nexxus doesn't have that information. I can tell you about {t}.",
}
LABELS = {
    "pt": {"caveat": "Ressalva", "sources": "Fontes"},
    "en": {"caveat": "Caveat", "sources": "Sources"},
}


@dataclass
class Answer:
    answer: str
    lang: str
    mode: str  # "model" | "offline" | "no_info"
    cards: list[str] = field(default_factory=list)
    sources: list[dict] = field(default_factory=list)
    caveats: list[str] = field(default_factory=list)
    text: str = ""

    def to_dict(self) -> dict:
        return asdict(self)


def _compose_text(a: Answer) -> str:
    lab = LABELS[a.lang]
    parts = [a.answer]
    if a.caveats:
        parts.append(f"{lab['caveat']}: " + " ".join(a.caveats))
    if a.sources:
        parts.append(f"{lab['sources']}:\n" + "\n".join(f"- {s['nome']}: {s['url']}" for s in a.sources))
    return "\n\n".join(parts)


def _finish(answer: str, lang: str, mode: str, used: list[Card]) -> Answer:
    sources, caveats = collect(used, lang)
    a = Answer(answer=answer, lang=lang, mode=mode, cards=[c.id for c in used], sources=sources, caveats=caveats)
    a.text = _compose_text(a)
    return a


def _pick_sentences(texto: str, question: str, keep: int = 3) -> str:
    """Escolhe as frases do cartão que mais falam da pergunta, na ordem original."""
    sentences = [s.strip() for s in re.split(r"(?<=[.!?])\s+", texto) if s.strip()]
    if len(sentences) <= keep:
        return " ".join(sentences)
    q = set(_terms(question))
    ranked = sorted(
        enumerate(sentences),
        key=lambda item: (-len(q & set(_terms(item[1]))), item[0]),
    )
    chosen = sorted(i for i, _ in ranked[:keep])
    return " ".join(sentences[i] for i in chosen)


def offline_answer(question: str, lang: str, hits: list[tuple[Card, float]]) -> Answer:
    """Resposta sem modelo: usa as frases mais próximas da pergunta no cartão mais forte."""
    if not hits:
        return _finish(NO_INFO[lang].format(t=TOPICS[lang]), lang, "no_info", [])
    used = [hits[0][0]]
    if len(hits) > 1 and hits[1][1] >= 0.75 * hits[0][1] and hits[1][0].tipo != "regra":
        used.append(hits[1][0])
    body = "\n\n".join(_pick_sentences(c.texto[lang], question) for c in used)
    return _finish(body, lang, "offline", used)


async def ask(question: str, lang: str | None = None, scene: str | None = None) -> Answer:
    question = question.strip()
    lang = lang if lang in ("pt", "en") else detect_lang(question)
    # A cena aberta só vale quando a pergunta é sobre ela: o front a manda em toda pergunta.
    aberta = scene_in_focus(question, CARDS, scene)
    if not aberta:
        scene = None
    hits = retrieve(question, CARDS, scene=scene)
    if aberta:
        # Com uma cena aberta, não manda outras cenas para o modelo: ele troca os lugares.
        hits = [(c, s) for c, s in hits if c.tipo != "cena" or c.id == aberta]
    cards = [c for c, _ in hits]

    if not llm.available():
        return offline_answer(question, lang, hits)

    try:
        raw = await llm.generate(SYSTEM_PROMPT, build_context(question, lang, cards, scene))
    except Exception as exc:  # rede, cota, tempo esgotado: cai para a reserva
        log.warning("modelo falhou, usando reserva: %s", exc)
        return offline_answer(question, lang, hits)

    if not cards:
        # Sem cartão, a única resposta aceita é dizer que não sabe.
        return _finish(NO_INFO[lang].format(t=TOPICS[lang]), lang, "no_info", [])

    ids = cited_ids(raw, CARDS)
    used = [CARDS[i] for i in ids if CARDS[i] in cards] or [cards[0]]
    answer = clean(raw)
    problems = check_answer(answer, cards) + wrong_scene(answer, scene)
    if problems:
        log.warning("resposta reprovada (%s); usando reserva", "; ".join(problems))
        return offline_answer(question, lang, hits)
    return _finish(answer, lang, "model", used)
