"""Base de cartões do agente: carrega, detecta idioma e busca os cartões certos.

A busca é um índice de termos por cartão, com três pesos (palavra-chave, título, texto)
e raridade (IDF): termo que só aparece num cartão vale mais que termo espalhado por vários.
Assim "Campinas mudou entre as passagens?" vai para a cena de Campinas, não para a aba Passes.
"""
from __future__ import annotations

import json
import math
import re
import unicodedata
from collections import defaultdict
from dataclasses import dataclass
from pathlib import Path

DATA = Path(__file__).resolve().parent.parent / "data" / "cards.json"


def norm(text: str) -> str:
    """Minúsculas, sem acento, sem pontuação extra."""
    text = unicodedata.normalize("NFKD", text.lower())
    text = "".join(c for c in text if not unicodedata.combining(c))
    text = text.replace("²", "2").replace("−", "-")
    return re.sub(r"[^a-z0-9.,\- ]+", " ", text)


PT_HINTS = {"o", "a", "que", "como", "qual", "quais", "voce", "e", "do", "da", "de", "nao", "por",
            "isso", "onde", "quando", "quanto", "quanta", "uma", "um", "os", "as", "sao", "foi",
            "agua", "chao", "mede", "medida", "mostra", "aconteceu", "tem", "ser", "esta", "mas",
            "para", "com", "sem", "ainda", "entre", "mudou", "deu", "vocês", "voces", "dados"}
EN_HINTS = {"the", "what", "how", "is", "are", "does", "do", "did", "which", "where", "when", "why",
            "much", "many", "you", "of", "this", "that", "can", "water", "ground", "show", "shows",
            "happened", "there", "with", "without", "your", "and", "was", "were", "data", "about"}

# Só palavras sem conteúdo. "agua", "water", "chao", "dados" e "mede" ficam fora daqui de
# propósito: são justamente o que a pergunta tem de útil.
STOP = {
    "o", "a", "os", "as", "um", "uma", "uns", "que", "como", "qual", "quais", "quanto", "quanta",
    "quantos", "quantas", "voce", "voces", "de", "do", "da", "dos", "das", "em", "no", "na", "nos",
    "nas", "por", "para", "com", "sem", "ate", "isso", "isto", "esse", "essa", "este", "esta",
    "aquele", "ele", "ela", "eles", "elas", "ser", "sao", "foi", "foram", "era", "tem", "ter",
    "mas", "mais", "menos", "ainda", "ja", "muito", "pouco", "onde", "quando", "porque", "por que",
    "me", "mim", "meu", "minha", "nosso", "nossa", "sobre", "fale", "diga", "explique", "quero",
    "sei", "sim", "nao", "aqui", "la", "entao", "pode", "podem", "deu", "mesmo", "outro", "outra",
    "the", "a", "an", "what", "how", "is", "are", "was", "were", "does", "do", "did", "which",
    "where", "when", "why", "who", "whom", "much", "many", "you", "your", "yours", "of", "in", "on",
    "at", "to", "for", "with", "without", "this", "that", "these", "those", "can", "could", "would",
    "should", "will", "there", "here", "about", "and", "or", "but", "not", "it", "its", "my", "our",
    "we", "us", "me", "tell", "tells", "say", "explain", "please", "want", "know", "yes", "no",
    "have", "has", "had", "been", "being", "from", "into", "over", "than", "then", "also", "very",
    "some", "any", "all", "more", "most", "just", "like", "get", "got", "make", "made", "one", "two",
    "eh", "ah", "oh", "se", "ja", "ao", "as", "os", "to", "be", "vs", "ou", "or", "if", "so", "up",
    "quem", "melhor", "pior", "best", "worst", "acha", "think", "opiniao", "opinion", "gosta",
    "deveria", "devo", "vale a pena", "worth",
}

WORD_OK = re.compile(r"^[a-z0-9][a-z0-9.,-]*$")


def _variants(term: str) -> set[str]:
    """O termo e formas vizinhas, para plural não derrubar a busca: pixels/pixel, passagens/passagem."""
    out = {term}
    if len(term) > 4 and term.endswith("s"):
        out.add(term[:-1])
        if term.endswith("ns"):
            out.add(term[:-2] + "m")
        if term.endswith("oes"):
            out.add(term[:-3] + "ao")
        if term.endswith("eis"):
            out.add(term[:-3] + "el")
    return out


def _terms(text: str) -> list[str]:
    out = []
    for raw in norm(text).split():
        t = raw.strip(".,-")
        if len(t) >= 2 and WORD_OK.match(t) and t not in STOP:
            out.append(t)
    return out


# Cena aberta no front -> cartão que fala dela. As oito cenas sazonais caem no mesmo cartão.
SCENE_CARDS = {
    "taquari": "taquari",
    "taquari_hidrograma": "taquari_hidrograma",
    "hidrograma": "taquari_hidrograma",
    "chokwe": "chokwe",
    "limpopo": "chokwe",
    "venezuela": "venezuela",
    "la_guaira": "venezuela",
    "caracas": "venezuela",
    "sindh": "sindh",
    "labrea": "labrea",
    "jakobshavn": "jakobshavn",
    "pantanal": "pantanal",
    "kalimantan": "kalimantan",
    "campo_de_gelo_sul": "campo_de_gelo_sul",
    "campo_gelo_sul": "campo_de_gelo_sul",
    "campinas": "campinas",
    "maceio": "maceio",
}

# Nome que o agente deve usar quando a cena está aberta no front.
SCENE_LABELS = {
    "taquari": "Vale do Taquari, Brasil",
    "taquari_hidrograma": "Vale do Taquari, Brasil",
    "hidrograma": "Vale do Taquari, Brasil",
    "chokwe": "Chókwè, Moçambique",
    "limpopo": "Chókwè, Moçambique",
    "venezuela": "La Guaira e Caracas, Venezuela",
    "la_guaira": "La Guaira e Caracas, Venezuela",
    "caracas": "La Guaira e Caracas, Venezuela",
    "sindh": "Sindh, Paquistão",
    "labrea": "Lábrea, Amazônia",
    "jakobshavn": "Jakobshavn, Groenlândia",
    "pantanal": "Pantanal, Brasil",
    "kalimantan": "Kalimantan, Bornéu",
    "campo_de_gelo_sul": "Campo de Gelo Sul, Patagônia",
    "campo_gelo_sul": "Campo de Gelo Sul, Patagônia",
    "campinas": "Campinas, Brasil",
    "maceio": "Maceió, Brasil",
}

# Nomes de lugar de cada cena, para barrar resposta que troca uma cena por outra.
SCENE_PLACES = {
    "sindh": ["sindh"],
    "labrea": ["labrea"],
    "jakobshavn": ["jakobshavn"],
    "pantanal": ["pantanal"],
    "kalimantan": ["kalimantan", "borneo"],
    "campo_de_gelo_sul": ["campo de gelo", "patagonian ice field", "patagonia"],
    "campo_gelo_sul": ["campo de gelo", "patagonian ice field", "patagonia"],
    "campinas": ["campinas"],
    "maceio": ["maceio"],
    "taquari": ["taquari", "lajeado"],
    "chokwe": ["chokwe", "limpopo"],
    "venezuela": ["venezuela", "caracas", "la guaira"],
}

# Palavras da pergunta que puxam um assunto sem usar o nome exato do cartão.
SYNONYMS = {
    "wavelength": ["24 cm", "banda l"],
    "comprimento": ["24 cm", "banda l"],
    "onda": ["24 cm"],
    "acres": ["hectares"],
    "hectare": ["hectares"],
    "milha": ["km"],
    "mile": ["km"],
    "miles": ["km"],
    "forecast": ["previsao"],
    "prever": ["previsao"],
    "predict": ["previsao"],
    "acurado": ["precisao"],
    "exato": ["precisao"],
    "exact": ["precisao"],
    "margem": ["faixa", "precisao"],
    "margin": ["faixa", "precisao"],
    "confiavel": ["limites"],
    "sure": ["precisao"],
    "certeza": ["precisao"],
    "alagada": ["area alagada"],
    "flooded": ["flooded area"],
    "sensor": ["banda l"],
    "resolucao": ["resolucao"],
}


@dataclass
class Card:
    id: str
    tipo: str
    base: str
    titulo: dict
    texto: dict
    ressalva: dict
    fontes: list
    palavras: list

    def tokens(self) -> set[str]:
        """Termos do título, nos dois idiomas (usado pelos testes e pela busca)."""
        return set(_terms(self.titulo["pt"] + " " + self.titulo["en"]))

    def weights(self) -> dict[str, float]:
        """Peso de cada termo: palavra-chave de uma palavra 3, título 1,5, texto 0,5.

        Palavra-chave de várias palavras ("qualquer lugar", "who are you") vale como frase
        inteira e só 1,0 por palavra solta: senão "lugar" ou "who" puxaria o cartão errado.
        """
        w: dict[str, float] = defaultdict(float)
        def put(term: str, peso: float) -> None:
            for v in _variants(term):
                w[v] = max(w[v], peso)

        for kw in self.palavras:
            peso = 3.0 if len(norm(kw).split()) == 1 else 1.0
            for t in _terms(kw):
                put(t, peso)
        for t in self.tokens():
            put(t, 1.5)
        for lang in ("pt", "en"):
            for t in _terms(self.texto[lang] + " " + self.ressalva.get(lang, "")):
                put(t, 0.5)
        return dict(w)

    def phrases(self) -> list[str]:
        """Palavras-chave de mais de uma palavra, para casar a frase inteira."""
        return [" " + norm(kw).strip() + " " for kw in self.palavras if " " in norm(kw).strip()]


def load_cards(path: Path = DATA) -> dict[str, Card]:
    raw = json.loads(path.read_text(encoding="utf-8"))
    return {c["id"]: Card(**c) for c in raw["cards"]}


def load_versao(path: Path = DATA) -> str:
    """Versão da base de cartões, para avisar quando as respostas prontas ficam velhas."""
    return str(json.loads(path.read_text(encoding="utf-8")).get("versao", ""))


def detect_lang(question: str) -> str:
    # Palavras comuns pesam mais que acentos: nomes como "Chókwè" ou "Lábrea" não mudam o idioma.
    words = norm(question).split()
    pt = sum(w in PT_HINTS for w in words)
    en = sum(w in EN_HINTS for w in words)
    low = question.lower()
    pt += 1.5 * len(re.findall(r"[ãõç]", low)) + 0.5 * len(re.findall(r"[áéíóúâêô]", low))
    return "pt" if pt > en else "en"


_INDEX: dict[int, tuple[dict[str, dict[str, float]], dict[str, float]]] = {}


def _index(cards: dict[str, Card]) -> tuple[dict[str, dict[str, float]], dict[str, float]]:
    """Pesos por cartão e IDF de cada termo. Fica em cache por conjunto de cartões."""
    key = id(cards)
    if key not in _INDEX:
        weights = {cid: c.weights() for cid, c in cards.items()}
        df: dict[str, int] = defaultdict(int)
        for w in weights.values():
            for t in w:
                df[t] += 1
        n = max(len(weights), 1)
        idf = {t: math.sqrt(n / d) for t, d in df.items()}  # termo raro pesa muito mais
        _INDEX[key] = (weights, idf)
    return _INDEX[key]


def _scores(question: str, cards: dict[str, Card]) -> dict[str, float]:
    """Quanto cada cartão casa com a pergunta, pelos termos e pelas frases inteiras. Sem a cena aberta."""
    weights, idf = _index(cards)
    q_norm = " " + norm(question) + " "
    # Cada termo da pergunta conta uma vez, pelo melhor casamento entre suas formas
    # (plural/singular). Sem isso "nuvens" casaria com "nuvem" e "nuvens" e contaria dobrado.
    groups: list[set[str]] = []
    for t in _terms(question):
        groups.append(_variants(t))
        for extra in SYNONYMS.get(t, []):
            for e in _terms(extra):
                groups.append(_variants(e))

    out: dict[str, float] = {}
    for cid, card in cards.items():
        w = weights[cid]
        score = sum(
            max((w[v] * idf.get(v, 1.0) for v in group if v in w), default=0.0)
            for group in groups
        )
        for phrase in card.phrases():
            if phrase in q_norm:
                score += 6.0
        out[cid] = score
    return out


# Nota mínima para um cartão valer como resposta.
MIN_SCORE = 3.2
# A pergunta aponta para o lugar que está na tela: "aqui", "esta cena", "this place".
DEICTIC = re.compile(
    r"\b(?:here|aqui)\b"
    r"|\b(?:this|that)\s+(?:scene|place|image|area|region|spot|location|map)\b"
    r"|\b[nd]?es[st][ae]\s+(?:cena|lugar|local|imagem|area|regiao|ponto|mapa)\b"
)


def scene_in_focus(question: str, cards: dict[str, Card], scene: str | None) -> str | None:
    """O cartão da cena aberta, se a pergunta é sobre ela; senão `None`.

    O front manda a cena aberta em toda pergunta, mesmo quando a pergunta é sobre outra coisa
    ("O que é o NISAR?", "De onde vêm os dados?", a cheia de outra cena). A cena aberta só entra
    quando a pergunta aponta para ela ("aqui", "esta cena") ou quando o cartão dela já responde
    por conta própria: pelo menos metade da nota do melhor cartão, e nenhuma outra cena casa melhor
    (a pergunta que dá o nome de outro lugar é sobre o outro lugar).
    """
    cid = SCENE_CARDS.get((scene or "").strip().lower()) if scene else None
    if not cid or cid not in cards:
        return None
    if DEICTIC.search(norm(question)):
        return cid
    scores = _scores(question, cards)
    own = scores[cid]
    if own < MIN_SCORE or own < 0.5 * max(scores.values()):
        return None
    other = max((v for k, v in scores.items() if k != cid and cards[k].tipo == "cena"), default=0.0)
    return cid if own >= other else None


def retrieve(question: str, cards: dict[str, Card], scene: str | None = None, k: int = 4) -> list[tuple[Card, float]]:
    """Pontua cada cartão pelos termos da pergunta, com peso e raridade."""
    scene_card = scene_in_focus(question, cards, scene)
    scored: list[tuple[Card, float]] = []
    for cid, score in _scores(question, cards).items():
        if scene_card == cid:
            score += 10.0
        if score > 0:
            scored.append((cards[cid], score))

    scored.sort(key=lambda x: (-x[1], x[0].id))
    if not scored:
        return []
    top = scored[0][1]
    # Corta o que é muito mais fraco que o primeiro: fonte fraca na tela é pior que fonte faltando.
    return [(c, s) for c, s in scored[:k] if s >= max(MIN_SCORE, 0.22 * top)]
