"""Conferência da resposta do modelo.

Reprova a resposta (e cai para o texto do cartão) quando ela:
  1. usa um número proibido (os números antigos do Taquari, o 780 km² do mapa de mudança);
  2. usa 63 km² sem dizer que é o mapa de mudança;
  3. escreve qualquer medida, data, magnitude ou ano que não esteja nos cartões;
  4. diz que os 53 km² são a área alagada total;
  5. diz para que lado o chão andou sem creditar à NASA;
  6. faz previsão do que vai acontecer;
  7. chama o Sentinel-1 (ESA) de satélite da NASA.
Links escritos pelo modelo são apagados antes da conferência de texto.
"""
from __future__ import annotations

import re

from .knowledge import SCENE_PLACES, Card, norm

# ---------------------------------------------------------------- números

# Números que nunca podem sair para a cheia do Taquari (ou para Chókwè).
FORBIDDEN = [
    re.compile(r"\b57\s*(km|quil)", re.I),
    re.compile(r"\b46[,.]7\b"),
    re.compile(r"\b45[,.]6\b"),
    re.compile(r"\b780\s*(km|quil)", re.I),
]
CHANGE_MAP = re.compile(r"mapa de mudan|change map", re.I)
SIXTY_THREE = re.compile(r"\b63\s*(km|quil)", re.I)

# Número seguido de unidade física, data, ano ou magnitude: precisa existir em algum cartão usado.
MEASURE = re.compile(
    r"(\d+(?:[.,]\d+)?)\s*(km²|km2|km|cm|mm|dB|m\b|metros|meters|hectares|acres|%|"
    r"graus|degrees|GB|GHz|dias|days|anos|years|horas|hours|minutos|minutes)",
    re.I,
)
MAGNITUDE = re.compile(r"magnitude(?:\s+de)?\s*(\d+(?:[.,]\d+)?)", re.I)
DATE = re.compile(r"\b(\d{1,2})/(\d{1,2})(?:/(\d{2,4}))?\b")
YEAR = re.compile(r"\b(19|20)\d{2}\b")

TAG = re.compile(r"\s*\[([a-z_]+)\]")
LINK = re.compile(r"https?://\S+|www\.\S+")

# ---------------------------------------------------------------- afirmações

FLOODED_AREA = re.compile(r"area alagada|flooded area|area inundada|inundated area", re.I)
NEGATION = re.compile(r"\bnao\b|\bnot\b|\bisn|\bare n|\bnem\b|\bmenos\b|\brather than\b|\bem vez\b|\bnunca\b|\bnever\b|\bdoes not\b|\bdo not\b", re.I)
DIRECTION = re.compile(
    # Sentido do movimento do CHÃO. "o sinal subiu" ou "a água baixou" não entram aqui.
    r"(?:chao|terreno|solo|ground|land|superficie|surface)[^.]{0,50}"
    r"(?:para (?:o )?(?:oeste|leste|norte|sul)|\bwest\b|\beast\b|\bnorth\b|\bsouth\b|\bsubiu\b|\bafundou\b|\bbaixou\b|\brose\b|\bsank\b|went up|went down|uplift)"
    r"|(?:moved|andou|deslocou|se moveu|shifted)[^.]{0,25}"
    r"(?:oeste|leste|norte|sul|\bwest\b|\beast\b|\bnorth\b|\bsouth\b|\bup\b|\bdown\b)"
    r"|westward|eastward",
    re.I,
)
FORECAST = re.compile(
    r"vai (?:alagar|chover|subir|acontecer|inundar)|ira (?:alagar|chover)|"
    r"will (?:flood|rain|rise|happen)|going to flood|prevemos|preve que|"
    r"podemos prever|we can predict|we predict|we forecast|nexxus forecasts",
    re.I,
)
# Só pega a afirmação errada mesmo ("Sentinel-1 da NASA"), não a frase que separa as agências.
NASA_SENTINEL = re.compile(
    r"sentinel[- ]?1[^.]{0,20}\bda nasa\b|nasa s sentinel[- ]?1|"
    r"sentinel[- ]?1 (?:is|was|e um|eh um|sao|are)[^.]{0,25}nasa|satelite da nasa[^.]{0,15}sentinel",
    re.I,
)
# O modelo às vezes entrega o rascunho junto: contagem de palavras, conferência de regras, o contexto.
META = re.compile(
    r"rule check|word count|contagem de palavras|checklist|lang:|cards:|question:|facts:|caveat:|open scene|"
    r"system prompt|my instructions|minhas instrucoes|as regras dizem",
    re.I,
)


def _digits(text: str) -> set[str]:
    out = set()
    for m in re.findall(r"\d+(?:[.,]\d+)?", norm(text)):
        m = m.replace(",", ".")
        out.add(m)
        out.add(m.lstrip("0") or "0")  # 07 e 7 contam como o mesmo número
    return out


def _sentences(text: str) -> list[str]:
    return [s for s in re.split(r"(?<=[.!?:;])\s+|\n+", text) if s.strip()]


def check_answer(answer: str, used: list[Card]) -> list[str]:
    """Devolve a lista de problemas. Lista vazia = resposta aprovada."""
    problems: list[str] = []
    flat = norm(answer)

    for rx in FORBIDDEN:
        if rx.search(answer):
            problems.append(f"número proibido: {rx.pattern}")
    if SIXTY_THREE.search(answer) and not CHANGE_MAP.search(answer):
        problems.append("63 km² sem dizer que é o mapa de mudança")

    allowed: set[str] = set()
    for c in used:
        allowed |= _digits(
            c.texto["pt"] + " " + c.texto["en"] + " " + c.ressalva.get("pt", "") + " " + c.ressalva.get("en", "")
        )

    def unknown(value: str) -> bool:
        v = value.replace(",", ".")
        return v not in allowed and (v.lstrip("0") or "0") not in allowed

    for value, _unit in MEASURE.findall(answer):
        if unknown(value):
            problems.append(f"número fora da base: {value}")
    for value in MAGNITUDE.findall(answer):
        if unknown(value):
            problems.append(f"magnitude fora da base: {value}")
    for d, m, y in DATE.findall(answer):
        for value in (d, m, y):
            if value and unknown(value):
                problems.append(f"data fora da base: {d}/{m}" + (f"/{y}" if y else ""))
                break
    for match in YEAR.finditer(answer):
        if unknown(match.group(0)):
            problems.append(f"ano fora da base: {match.group(0)}")

    for sentence in _sentences(answer):
        s_norm = norm(sentence)
        # "pelo menos" e "ao menos" não negam nada: "a área alagada foi de pelo menos 53 km²" é
        # justamente a afirmação que a regra barra, e o "menos" de NEGATION a deixava passar.
        s_norm = re.sub(r"\b(?:pelo|ao) menos\b", " ", s_norm)
        if FLOODED_AREA.search(s_norm) and not NEGATION.search(s_norm):
            problems.append("afirma que é a área alagada")
        if DIRECTION.search(s_norm) and "nasa" not in s_norm:
            problems.append("sentido do movimento do chão sem creditar à NASA")
        if FORECAST.search(s_norm) and not NEGATION.search(s_norm):
            problems.append("previsão do que vai acontecer")
        if NASA_SENTINEL.search(s_norm) and not NEGATION.search(s_norm):
            problems.append("Sentinel-1 citado como satélite da NASA")
    if META.search(answer) or META.search(flat):  # flat ignora acento, answer mantém os dois-pontos
        problems.append("resposta com rascunho ou contexto vazado")

    return problems


def wrong_scene(answer: str, scene: str | None) -> list[str]:
    """Barra a resposta que fala de outra cena quando o front diz qual está aberta."""
    chave = (scene or "").strip().lower()
    if chave not in SCENE_PLACES:
        return []
    flat = norm(answer)
    abertos = SCENE_PLACES[chave]
    if any(nome in flat for nome in abertos):
        return []
    outros = [n for k, nomes in SCENE_PLACES.items() if k != chave for n in nomes if n not in abertos]
    citados = sorted({n for n in outros if n in flat})
    if citados:
        return [f"resposta fala de outra cena ({', '.join(citados)}) e não da aberta ({abertos[0]})"]
    return []


def cited_ids(answer: str, available: dict[str, Card]) -> list[str]:
    seen = []
    for cid in TAG.findall(answer):
        if cid in available and cid not in seen:
            seen.append(cid)
    return seen


def clean(answer: str) -> str:
    """Tira etiquetas [id], links e marcação que o modelo possa ter escrito."""
    answer = TAG.sub("", answer)
    answer = LINK.sub("", answer)
    answer = re.sub(r"^#+\s*", "", answer, flags=re.M)
    answer = re.sub(r"^\s*(answer|resposta)\s*:\s*", "", answer, flags=re.I)
    # Cabeçalho do contexto que o modelo às vezes copia na primeira linha.
    answer = re.sub(r"^\s*(open scene|lang|question|cards)\s*:[^\n]*\n?", "", answer, flags=re.I)
    answer = answer.replace("**", "")
    return re.sub(r"[ \t]+\n", "\n", answer).strip()


def collect(cards: list[Card], lang: str) -> tuple[list[dict], list[str]]:
    sources, caveats = [], []
    for c in cards:
        for f in c.fontes:
            if f not in sources:
                sources.append(f)
        cav = c.ressalva.get(lang, "")
        if cav and cav not in caveats:
            caveats.append(cav)
    return sources, caveats
