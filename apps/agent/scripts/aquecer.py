"""Gera data/respostas_prontas.json: as respostas das perguntas mais prováveis, já aprovadas.

Por que existe: a chave gratuita do AI Studio dá 15 pedidos por minuto. Perguntas já respondidas
entram no cache do servidor ao subir e não gastam cota nenhuma durante a demo e o julgamento.

    python scripts/aquecer.py                 # usa a chave do .env ou do ambiente
    python scripts/aquecer.py --pausa 6       # mais devagar, se tomar 429
    python scripts/aquecer.py --so-cenas      # só as perguntas de cena, mais rápido

Rode de novo sempre que mexer em data/cards.json.
"""
from __future__ import annotations

import argparse
import asyncio
import json
import os
import sys
import time
from pathlib import Path

RAIZ = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(RAIZ))

# Carrega o .env antes de importar o agente: o modelo é escolhido na importação. Vale o de
# apps/agent e, depois, o da raiz do repositório, que é onde a chave fica (o do Docker).
for env in (RAIZ / ".env", RAIZ.parent.parent / ".env"):
    if env.exists():
        for linha in env.read_text(encoding="utf-8").splitlines():
            if "=" in linha and not linha.strip().startswith("#"):
                chave, valor = linha.split("=", 1)
                if valor.strip().strip("\"'"):
                    os.environ.setdefault(chave.strip(), valor.strip().strip("\"'"))

from agent import core, llm  # noqa: E402
from agent.knowledge import scene_in_focus  # noqa: E402

CENAS = [
    "taquari", "chokwe", "venezuela", "sindh", "labrea", "jakobshavn",
    "pantanal", "kalimantan", "campo_de_gelo_sul", "campinas", "maceio",
]
# Perguntas que o jurado faz com uma cena aberta na tela.
POR_CENA = [
    ("O que mudou aqui?", "pt"),
    ("What changed here?", "en"),
    ("Qual a fonte disso?", "pt"),
    ("What is the source?", "en"),
]
# As sugestões da aba Ask (`ask.suggestions`, em apps/web/src/i18n): o clique mais provável da demo.
# Mudou lá, mude aqui.
SUGESTOES = [
    ("What changed here?", "en"), ("Why can radar see through clouds?", "en"), ("What is NISAR?", "en"),
    ("How reliable is this data?", "en"), ("Where does the data come from?", "en"),
    ("What is one fringe worth?", "en"),
    ("O que mudou aqui?", "pt"), ("Por que o radar atravessa nuvens?", "pt"), ("O que é o NISAR?", "pt"),
    ("Quão confiável é este dado?", "pt"), ("De onde vêm os dados?", "pt"), ("Quanto vale uma franja?", "pt"),
]


def alvos(so_cenas: bool) -> list[dict]:
    lista: list[dict] = []
    if not so_cenas:
        banco = json.loads((RAIZ / "tests" / "perguntas.json").read_text(encoding="utf-8"))
        for item in banco:
            if item["card"] is None:
                continue  # fora do assunto não chama o modelo
            lista.append({"question": item["q"], "lang": item["lang"], "scene": item.get("cena")})
    # Cada sugestão sem cena e com cada cena aberta: a de baixo tira as que dão na mesma resposta.
    for pergunta, lang in SUGESTOES:
        for cena in [None] + CENAS:
            lista.append({"question": pergunta, "lang": lang, "scene": cena})
    for cena in CENAS:
        for pergunta, lang in POR_CENA:
            lista.append({"question": pergunta, "lang": lang, "scene": cena})
    # A marca é a mesma da chave do cache do servidor: a cena só conta quando a pergunta é sobre ela.
    vistos, unicos = set(), []
    for item in lista:
        foco = scene_in_focus(item["question"], core.CARDS, item["scene"])
        marca = (item["question"].lower(), item["lang"], foco)
        if marca not in vistos:
            vistos.add(marca)
            unicos.append({**item, "scene": item["scene"] if foco else None})
    return unicos


async def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--pausa", type=float, default=5.0, help="segundos entre pedidos (padrão 5)")
    ap.add_argument("--so-cenas", action="store_true", help="só as perguntas com cena aberta")
    args = ap.parse_args()

    if not llm.available():
        print("sem GEMINI_API_KEY: nada a aquecer (o agente responderia em modo reserva)")
        return 1

    lista = alvos(args.so_cenas)
    print(f"modelo {llm.MODEL} | {len(lista)} perguntas | pausa de {args.pausa}s")
    prontas, falhas = [], []
    for i, item in enumerate(lista, 1):
        resposta = None
        for tentativa in (1, 2):
            await asyncio.sleep(args.pausa if i > 1 or tentativa > 1 else 0)
            a = await core.ask(item["question"], item["lang"], item["scene"])
            if a.mode == "model":
                resposta = a.to_dict()
                break
            if tentativa == 1:
                print(f"  {i:3d}/{len(lista)} {a.mode:7s} repetindo: {item['question'][:50]}")
                await asyncio.sleep(max(args.pausa, 10))
        if resposta:
            prontas.append({**item, "resposta": resposta})
            print(f"  {i:3d}/{len(lista)} ok      [{','.join(resposta['cards'])}] {item['question'][:50]}")
        else:
            falhas.append(item)
            print(f"  {i:3d}/{len(lista)} FALHOU  {item['question'][:50]}")

    destino = RAIZ / "data" / "respostas_prontas.json"
    destino.write_text(
        json.dumps(
            {
                "gerado_em": time.strftime("%Y-%m-%dT%H:%M:%S"),
                "modelo": llm.MODEL,
                "cards_versao": core.CARDS_VERSAO,
                "respostas": prontas,
            },
            ensure_ascii=False,
            indent=1,
        ),
        encoding="utf-8",
    )
    print(f"\n{len(prontas)} respostas em {destino.relative_to(RAIZ)}")
    if falhas:
        print(f"{len(falhas)} ficaram sem resposta do modelo (o agente usa o cartão nelas):")
        for item in falhas:
            print("   -", item["question"])
    return 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
