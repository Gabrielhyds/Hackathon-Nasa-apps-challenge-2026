"""Testes do agente. Rodam sem internet: o modelo é substituído por respostas falsas."""
import asyncio
import json
import re
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from agent import core, llm
from agent.guard import check_answer
from agent.knowledge import SCENE_CARDS, retrieve
from agent.main import app, _cache, _hits

QUESTIONS = json.loads((Path(__file__).parent / "perguntas.json").read_text(encoding="utf-8"))
FORBIDDEN_TEXT = ["57 km", "46,7", "46.7", "45,6", "780 km"]
SCENE_CARDS_IDS = {"taquari", "taquari_hidrograma", "chokwe", "venezuela", "sazonais",
                   "sindh", "labrea", "jakobshavn", "pantanal", "kalimantan",
                   "campo_de_gelo_sul", "campinas", "maceio"}


def run(coro):
    return asyncio.run(coro)


@pytest.fixture(autouse=True)
def offline(monkeypatch):
    monkeypatch.delenv("GEMINI_API_KEY", raising=False)
    monkeypatch.delenv("GOOGLE_GENAI_USE_VERTEXAI", raising=False)
    _cache.clear()
    _hits.clear()


# ---------- O banco de perguntas, no modo reserva ----------

@pytest.mark.parametrize("item", QUESTIONS, ids=[q["q"][:40] for q in QUESTIONS])
def test_banco_de_perguntas(item):
    a = run(core.ask(item["q"], scene=item.get("cena")))
    assert a.lang == item["lang"], f"idioma errado: {a.lang}"
    if item["card"] is None:
        assert a.mode == "no_info" and not a.sources
        return
    ok = [item["card"]] + item.get("aceita", [])
    assert a.cards and a.cards[0] in ok, f"cartão {a.cards} não está em {ok}"
    for bad in FORBIDDEN_TEXT:
        assert bad not in a.text
    if a.cards[0] in SCENE_CARDS_IDS:
        assert a.caveats, "cena sem ressalva"
        assert a.sources, "cena sem fonte"


def test_taquari_sempre_explica_agua_aberta():
    a = run(core.ask("Is 53 km² the flooded area?"))
    assert "53" in a.text and "not the total flooded area" in a.text


def test_reserva_nao_despeja_o_cartao_inteiro():
    a = run(core.ask("A cada quantos dias o satélite passa no mesmo lugar?"))
    assert a.mode == "offline" and "12 dias" in a.answer
    # Fica só o trecho que responde: a última frase do cartão não entra.
    assert "3 anos de duração prevista" not in a.answer


def test_cena_do_front_puxa_o_cartao_certo():
    for cena, card in [("pantanal", "pantanal"), ("maceio", "maceio"), ("chokwe", "chokwe"),
                       ("campo_gelo_sul", "campo_de_gelo_sul")]:
        hits = retrieve("o que mudou aqui?", core.CARDS, scene=cena)
        assert hits and hits[0][0].id == card, f"{cena} -> {[h[0].id for h in hits]}"


def test_cena_aberta_nao_responde_pergunta_sobre_outro_assunto():
    # O front manda a cena aberta em toda pergunta. Ela não pode tomar o lugar do cartão certo.
    for q, cena, card in [
        ("What is NISAR?", "campinas", "nisar"),
        ("Where does the data come from?", "taquari", "dados_nisar"),
        ("O que é o Nexxus?", "taquari", "nexxus"),
        ("How big was the Taquari flood?", "campinas", "taquari"),
        ("Qual foi a magnitude dos terremotos da Venezuela?", "taquari", "venezuela"),
        ("A cheia do Limpopo foi vista através das nuvens?", "taquari", "chokwe"),
    ]:
        a = run(core.ask(q, scene=cena))
        assert a.cards and a.cards[0] == card, f"{q} com {cena} aberta -> {a.cards}"


def test_cena_aberta_nao_responde_pergunta_fora_do_assunto():
    a = run(core.ask("Who will win the World Cup?", scene="campinas"))
    assert a.mode == "no_info" and not a.cards


def test_cena_aberta_vale_quando_a_pergunta_aponta_para_ela():
    for q, cena in [("What changed here?", "campinas"), ("O que mudou nesta cena?", "pantanal"),
                    ("Isso é a área alagada?", "taquari")]:
        a = run(core.ask(q, scene=cena))
        assert a.cards and a.cards[0] == cena, f"{q} com {cena} aberta -> {a.cards}"


@pytest.mark.parametrize("item", [q for q in QUESTIONS if not q.get("cena")], ids=lambda q: q["q"][:40])
def test_banco_de_perguntas_com_uma_cena_qualquer_aberta(item):
    # A mesma pergunta, com uma cena sazonal aberta: a resposta não pode virar a da cena.
    a = run(core.ask(item["q"], scene="kalimantan"))
    if item["card"] is None:
        assert a.mode == "no_info"
        return
    assert a.cards and a.cards[0] in [item["card"]] + item.get("aceita", []), f"cartão {a.cards}"


def test_frase_inteira_casa_mesmo_com_ponto_ou_virgula():
    def nota(q, card):
        return {c.id: s for c, s in retrieve(q, core.CARDS)}.get(card, 0)
    assert run(core.ask("who are you.")).cards == run(core.ask("who are you")).cards == ["nexxus"]
    assert nota("Tell me about the change map.", "taquari_numeros_antigos") == nota("Tell me about the change map?", "taquari_numeros_antigos") > 6
    assert nota("Explain pulse compression, please", "fourier") == nota("Explain pulse compression please", "fourier") > 6


def test_toda_cena_do_front_tem_cartao():
    for card_id in SCENE_CARDS.values():
        assert card_id in core.CARDS


# ---------- Base de cartões ----------

def test_cartoes_bem_formados():
    assert len(core.CARDS) >= 28
    for card in core.CARDS.values():
        assert card.palavras, card.id
        for lang in ("pt", "en"):
            assert card.texto[lang].strip(), (card.id, lang)
            assert card.titulo[lang].strip(), (card.id, lang)
            assert lang in card.ressalva, (card.id, lang)
        for fonte in card.fontes:
            assert fonte["url"].startswith("https://"), (card.id, fonte)
            assert fonte["nome"].strip(), card.id
        if card.tipo == "cena":
            assert card.fontes and card.ressalva["pt"], f"{card.id}: cena precisa de fonte e ressalva"


def test_numeros_antigos_nao_estao_na_base():
    todo = " ".join(c.texto["pt"] + c.texto["en"] for c in core.CARDS.values())
    assert "46,7" not in todo and "45,6" not in todo
    assert "57 km" not in todo


# ---------- Caminho com modelo (respostas falsas) ----------

def fake_model(monkeypatch, reply):
    monkeypatch.setenv("GEMINI_API_KEY", "teste")

    async def gen(system, user):
        return reply

    monkeypatch.setattr(llm, "generate", gen)


def test_modelo_resposta_boa_vira_fonte_e_ressalva(monkeypatch):
    fake_model(monkeypatch, "NISAR saw about 53 km² of new open water, through the clouds [taquari].")
    a = run(core.ask("What did NISAR see in the Taquari flood?"))
    assert a.mode == "model"
    assert "[taquari]" not in a.answer
    assert any("jornaldocomercio" in s["url"] for s in a.sources)
    assert a.caveats


def test_modelo_numero_proibido_cai_para_reserva(monkeypatch):
    fake_model(monkeypatch, "The flood covered 57 km² [taquari].")
    a = run(core.ask("How big was the Taquari flood?"))
    assert a.mode == "offline" and "57 km" not in a.text


def test_modelo_numero_inventado_cai_para_reserva(monkeypatch):
    fake_model(monkeypatch, "About 120 km² flooded [taquari].")
    a = run(core.ask("How big was the Taquari flood?"))
    assert a.mode == "offline"


def test_contexto_do_modelo_diz_qual_cena_esta_aberta(monkeypatch):
    from agent.prompt import build_context
    cards = [core.CARDS["campinas"]]
    assert "OPEN SCENE: Campinas, Brasil\n" in build_context("What changed here?", "en", cards, "campinas")
    assert "OPEN SCENE" not in build_context("What changed here?", "en", cards, None)
    assert "OPEN SCENE" not in build_context("What changed here?", "en", cards, "lugar-desconhecido")
    # e a pergunta com cena aberta chega ao modelo com essa linha
    monkeypatch.setenv("GEMINI_API_KEY", "teste")
    visto = []

    async def gen(system, user):
        visto.append(user)
        return "In Campinas the two passes look almost the same [campinas]."

    monkeypatch.setattr(llm, "generate", gen)
    run(core.ask("What changed here?", scene="campinas"))
    assert visto and "OPEN SCENE: Campinas, Brasil" in visto[0]


def test_modelo_link_inventado_e_removido(monkeypatch):
    fake_model(monkeypatch, "NISAR flies 747 km up [nisar]. See https://fake.example.com")
    a = run(core.ask("What is NISAR?"))
    assert a.mode == "model" and "fake.example" not in a.text


def test_modelo_fora_do_ar_cai_para_reserva(monkeypatch):
    monkeypatch.setenv("GEMINI_API_KEY", "teste")

    async def boom(system, user):
        raise TimeoutError("sem rede")

    monkeypatch.setattr(llm, "generate", boom)
    a = run(core.ask("What is NISAR?"))
    assert a.mode == "offline" and a.sources


def test_sem_cartao_nunca_usa_texto_do_modelo(monkeypatch):
    fake_model(monkeypatch, "Brazil will win the World Cup.")
    a = run(core.ask("Who will win the World Cup?"))
    assert a.mode == "no_info" and "Brazil" not in a.text


def test_sem_cartao_nao_gasta_pedido_do_modelo(monkeypatch):
    monkeypatch.setenv("GEMINI_API_KEY", "teste")
    chamou = []

    async def gen(system, user):
        chamou.append(1)
        return "Brazil will win the World Cup."

    monkeypatch.setattr(llm, "generate", gen)
    a = run(core.ask("Who will win the World Cup?"))
    assert a.mode == "no_info" and not chamou


def test_modelo_area_alagada_cai_para_reserva(monkeypatch):
    fake_model(monkeypatch, "The flooded area was about 53 km² [taquari].")
    a = run(core.ask("How big was the Taquari flood?"))
    assert a.mode == "offline"


def test_guard_pelo_menos_nao_conta_como_negacao():
    cards = [core.CARDS["taquari"]]
    assert check_answer("A área alagada foi de pelo menos 53 km².", cards)
    assert check_answer("Ao menos 53 km² de área alagada apareceram no radar.", cards)
    assert check_answer("O vale vai alagar de novo, pelo menos em parte.", cards)
    # a negação de verdade continua valendo
    assert check_answer("Os 53 km² não são a área alagada: são água aberta nova.", cards) == []
    assert check_answer("É água aberta nova, e a área alagada real é maior, nunca menos que isso.", cards) == []


def test_modelo_sentido_do_chao_cai_para_reserva(monkeypatch):
    fake_model(monkeypatch, "The ground moved west by about 12 cm [venezuela].")
    a = run(core.ask("Quanto o chão andou na Venezuela?"))
    assert a.mode == "offline"


def test_modelo_previsao_cai_para_reserva(monkeypatch):
    fake_model(monkeypatch, "O vale vai alagar de novo em dezembro [taquari].")
    a = run(core.ask("Vai alagar de novo?"))
    assert a.mode == "offline"


# ---------- Verificador, caso a caso ----------

def test_area_do_mapa_de_mudanca_so_com_o_nome_dele():
    card = core.CARDS["taquari_numeros_antigos"]
    assert check_answer("O mapa de mudança mostra cerca de 55 km² mais escuros.", [card]) == []
    assert check_answer("No par de 11/07 contra 23/07, o mapa de mudança marca cerca de 60 km².", [card]) == []
    assert check_answer("Foram 55 km² de água.", [card])
    assert check_answer("Foram 60 km² de água.", [card])
    # O 63 km² saiu da tela e dos cartões: não passa nem com o nome do mapa.
    assert check_answer("O mapa de mudança mostra cerca de 63 km².", [card])


def test_copa_do_mundo_nao_e_copa_das_arvores():
    a = asyncio.run(core.ask("E quem ganha a Copa?", "pt"))
    assert a.mode == "no_info" and a.cards == []
    hits = retrieve("O radar atravessa a copa das árvores?", core.CARDS)
    assert hits and hits[0][0].id == "radar_basico"


def test_daqui_aponta_para_a_cena_aberta():
    from agent.knowledge import scene_in_focus

    assert scene_in_focus("Quando foram as passagens daqui?", core.CARDS, "campinas") == "campinas"
    a = asyncio.run(core.ask("Quando foram as passagens daqui?", "pt", "campinas"))
    assert "campinas" in a.cards and "27/06 e 06/11/2026" in a.answer


def test_cartoes_de_cena_trazem_as_datas_do_par():
    # As datas vêm do manifest das imagens (apps/api/scene-images/manifest.json).
    pares = {
        "sindh": ("17/06", "09/09/2026"), "labrea": ("24/08", "23/10/2026"),
        "jakobshavn": ("23/06", "02/11/2026"), "pantanal": ("17/07", "21/10/2026"),
        "kalimantan": ("30/06", "28/10/2026"), "campo_de_gelo_sul": ("28/06", "26/10/2026"),
        "campinas": ("27/06", "06/11/2026"), "maceio": ("23/06", "21/10/2026"),
    }
    for cid, (antes, depois) in pares.items():
        assert f"em {antes} e {depois}" in core.CARDS[cid].texto["pt"], cid


def test_guard_aceita_resposta_fiel():
    cards = [core.CARDS["taquari"], core.CARDS["taquari_metodo"]]
    boa = ("O time mediu cerca de 53 km² de água aberta nova na passagem de 23/07/2026, "
           "com faixa de 49 a 56 km². Não é a área alagada total.")
    assert check_answer(boa, cards) == []


def test_guard_pega_data_magnitude_e_ano_fora_da_base():
    cards = [core.CARDS["taquari"]]
    assert check_answer("A cheia foi em 15/03/2026.", cards)
    assert check_answer("Foi um terremoto de magnitude 9,9.", cards)
    assert check_answer("Isso aconteceu em 1998.", cards)


def test_guard_pega_sentinel_como_nasa():
    cards = [core.CARDS["outras_fontes"]]
    assert check_answer("O Sentinel-1 é um satélite da NASA.", cards)


def test_guard_aceita_resposta_que_nega_a_previsao():
    cards = [core.CARDS["limites"]]
    boa = ("Nexxus cannot forecast. It measures what already happened and does not say "
           "whether it will rain or flood again.")
    assert check_answer(boa, cards) == []


def test_guard_aceita_separar_esa_de_nasa():
    cards = [core.CARDS["outras_fontes"], core.CARDS["parceiros"]]
    boa = ("Não. O mapa de água OPERA DSWx-S1 usa dados dos satélites Sentinel-1 da ESA, "
           "e não da NASA. O Nexxus mantém os dados da NASA como base.")
    assert check_answer(boa, cards) == []


def test_guard_barra_rascunho_vazado():
    cards = [core.CARDS["taquari"]]
    assert check_answer("Word Count & Rule Check: ok. A cheia foi grande.", cards)
    assert check_answer("CARDS: [taquari] facts: 53 km²", cards)


def test_guard_aceita_sentido_do_chao_creditado_a_nasa():
    cards = [core.CARDS["venezuela"]]
    assert check_answer("Segundo a NASA, o chão andou até 60 cm para oeste.", cards) == []


def test_guard_nao_confunde_nome_de_lugar_com_sentido_do_chao():
    # "land" dentro de Groenlândia/Greenland/island/wetland e "sul" dentro de "resultado" não são o chão andando.
    for card, frase in [
        ("jakobshavn", "Em Jakobshavn, na Groenlândia, o sinal do radar subiu em alguns pontos e caiu em outros."),
        ("jakobshavn", "In Greenland the radar signal went up in some places and down in others."),
        ("kalimantan", "On Borneo island the signal went down in a few spots."),
        ("pantanal", "In the Pantanal wetland the signal went up where the ground got wetter."),
        ("campo_de_gelo_sul", "O gelo se moveu, e o resultado aparece na imagem."),
    ]:
        assert check_answer(frase, [core.CARDS[card]]) == [], frase
    # o que a regra existe para barrar continua barrado
    cards = [core.CARDS["venezuela"]]
    assert check_answer("The ground moved west near the airport.", cards)
    assert check_answer("O chão andou para o sul.", cards)
    assert check_answer("The land surface went up near the coast.", cards)


# ---------- Cota do modelo e respostas prontas ----------

def test_cota_por_minuto_segura_o_modelo(monkeypatch):
    monkeypatch.setenv("GEMINI_API_KEY", "teste")
    chamou = []

    async def gen(system, user):
        chamou.append(1)
        return "NISAR flies 747 km up [nisar]."

    monkeypatch.setattr(llm, "generate", gen)
    monkeypatch.setattr(llm, "_chamadas", __import__("collections").defaultdict(__import__("collections").deque))
    a = run(core.ask("What is NISAR?"))
    assert a.mode == "model" and chamou


def test_modelo_lento_passa_a_vez_para_o_proximo(monkeypatch):
    import asyncio as _a
    import collections as _c
    from types import SimpleNamespace

    tentados = []

    class Modelos:
        async def generate_content(self, model, contents, config):
            tentados.append(model)
            if len(tentados) == 1:
                await _a.sleep(1)  # o primeiro modelo da fila não responde a tempo
            return SimpleNamespace(text="NISAR flies 747 km up [nisar].")

    monkeypatch.setattr(llm, "_client", SimpleNamespace(aio=SimpleNamespace(models=Modelos())))
    monkeypatch.setattr(llm, "TIMEOUT_S", 0.05)
    monkeypatch.setattr(llm, "_active", None)
    monkeypatch.setattr(llm, "_chamadas", _c.defaultdict(_c.deque))
    monkeypatch.setattr(llm, "_bloqueado_ate", {})
    assert run(llm.generate("sistema", "pergunta")) == "NISAR flies 747 km up [nisar]."
    assert tentados == llm.FALLBACKS[:2]


def test_sem_cota_cai_para_reserva(monkeypatch):
    import time as _t
    monkeypatch.setenv("GEMINI_API_KEY", "teste")
    # Todos os modelos em pausa por 429: generate nem tenta a rede.
    monkeypatch.setattr(llm, "_bloqueado_ate", {m: _t.monotonic() + 60 for m in llm.FALLBACKS})
    a = run(core.ask("What is NISAR?"))
    assert a.mode == "offline" and a.sources


@pytest.mark.parametrize("conteudo", [
    "[]",
    '{"respostas": {}}',
    '{"respostas": [{"resposta": {"lang": "pt", "answer": "sem pergunta"}}]}',
    '{"respostas": [{"question": "O que é o NISAR?", "resposta": {"answer": "sem idioma"}}]}',
    '{"respostas": ["texto solto", null]}',
])
def test_respostas_prontas_com_formato_errado_nao_derrubam_o_servidor(tmp_path, monkeypatch, conteudo):
    import agent.main as m
    arquivo = tmp_path / "respostas_prontas.json"
    arquivo.write_text(conteudo, encoding="utf-8")
    monkeypatch.setattr(m, "PRONTAS", arquivo)
    assert m._carregar_prontas() == 0


def test_respostas_prontas_entram_no_cache(tmp_path, monkeypatch):
    import json as _json
    import agent.main as m
    pronta = {
        "answer": "Resposta guardada antes do evento.",
        "lang": "pt", "mode": "model", "cards": ["nisar"],
        "sources": [{"nome": "NASA", "url": "https://science.nasa.gov/mission/nisar/"}],
        "caveats": [], "text": "Resposta guardada antes do evento.",
    }
    arquivo = tmp_path / "respostas_prontas.json"
    arquivo.write_text(_json.dumps({
        "modelo": "teste", "cards_versao": core.CARDS_VERSAO,
        "respostas": [{"question": "O que é o NISAR?", "lang": "pt", "scene": None, "resposta": pronta}],
    }), encoding="utf-8")
    monkeypatch.setattr(m, "PRONTAS", arquivo)
    assert m._carregar_prontas() == 1

    c = TestClient(app)
    # Sem "lang" na chamada: a chave usa o idioma detectado, então a resposta pronta serve.
    r = c.post("/api/ask", json={"question": "O que é o NISAR?"}).json()
    assert r["mode"] == "model" and r["answer"] == pronta["answer"]


def test_respostas_prontas_tortas_nao_derrubam(tmp_path, monkeypatch):
    import agent.main as m
    arquivo = tmp_path / "torto.json"
    arquivo.write_text("{isso não é json", encoding="utf-8")
    monkeypatch.setattr(m, "PRONTAS", arquivo)
    assert m._carregar_prontas() == 0
    monkeypatch.setattr(m, "PRONTAS", tmp_path / "nao_existe.json")
    assert m._carregar_prontas() == 0


# ---------- HTTP ----------

def test_http_ask_e_health():
    c = TestClient(app)
    saude = c.get("/api/health").json()
    assert saude["ok"] and saude["cards"] >= 28
    r = c.post("/api/ask", json={"question": "What is NISAR?"})
    assert r.status_code == 200 and r.json()["sources"]
    assert c.get("/").status_code == 200


def test_http_ask_com_cena_e_idioma():
    c = TestClient(app)
    r = c.post("/api/ask", json={"question": "O que mudou aqui?", "lang": "pt", "scene": "pantanal"})
    body = r.json()
    assert body["lang"] == "pt" and body["cards"][0] == "pantanal"


def test_http_rejeita_pergunta_vazia_ou_longa():
    c = TestClient(app)
    assert c.post("/api/ask", json={"question": ""}).status_code == 422
    assert c.post("/api/ask", json={"question": "x" * 501}).status_code == 422


def test_http_limite_por_minuto(monkeypatch):
    import agent.main as m
    monkeypatch.setattr(m, "RATE_PER_MIN", 3)
    c = TestClient(app)
    codes = [c.post("/api/ask", json={"question": f"What is NISAR {i}?"}).status_code for i in range(5)]
    assert codes[:3] == [200, 200, 200] and 429 in codes[3:]


def test_texto_dos_cartoes_comeca_com_maiuscula():
    # O modo reserva responde com as frases do cartão: a primeira letra aparece na tela.
    for card in core.CARDS.values():
        for lang in ("pt", "en"):
            for frase in re.split(r"(?<=[.!?])\s+", card.texto[lang]):
                assert not frase[:1].islower(), f"{card.id} ({lang}): {frase[:50]}"


# ---------- O que o modelo real mostrou em 15/11 ----------

def test_etiqueta_com_varios_cartoes_some_e_vira_fonte(monkeypatch):
    fake_model(monkeypatch, "NISAR is a NASA and ISRO radar satellite, while Sentinel-1 is ESA's [parceiros, nisar].")
    a = run(core.ask("How is NISAR different from Sentinel-1?"))
    assert a.mode == "model" and "[" not in a.answer
    assert set(a.cards) == {"parceiros", "nisar"}


def test_pergunta_de_seguimento_e_sobre_a_cena_aberta():
    # O agente não recebe a conversa: sem palavra de conteúdo, a pergunta é sobre o que está na tela.
    for q, cena in [("E por quê?", "taquari"), ("Tell me more", "taquari"),
                    ("Why does it matter?", "chokwe"), ("Conte mais", "campinas")]:
        a = run(core.ask(q, scene=cena))
        assert a.cards == [cena], f"{q} com {cena} aberta -> {a.mode} {a.cards}"
    # Sem cena aberta não há do que falar, e pergunta com assunto próprio segue fora.
    assert run(core.ask("E por quê?")).mode == "no_info"
    assert run(core.ask("Who are you?", scene="taquari")).cards[0] != "taquari"


def test_este_dado_aponta_para_a_cena_aberta(monkeypatch):
    # Na reserva responde o cartão dos limites, e a cena entra com a ressalva e as fontes dela.
    for q, cena in [("How reliable is this data?", "taquari"), ("Quão confiável é este dado?", "chokwe")]:
        a = run(core.ask(q, scene=cena))
        assert a.cards[0] == "limites" and cena in a.cards, f"{q} com {cena} aberta -> {a.cards}"
        assert core.CARDS[cena].ressalva[a.lang] in a.caveats
    assert "taquari" not in run(core.ask("How reliable is this data?")).cards
    # O modelo recebe o cartão da cena junto com o dos limites.
    monkeypatch.setenv("GEMINI_API_KEY", "teste")
    visto = []

    async def gen(system, user):
        visto.append(user)
        return "In the Taquari valley the passes are in the PROVISIONAL release [taquari]."

    monkeypatch.setattr(llm, "generate", gen)
    run(core.ask("How reliable is this data?", scene="taquari"))
    assert "[taquari]" in visto[0] and "[limites]" in visto[0] and "OPEN SCENE" in visto[0]


def test_recusa_do_modelo_vira_nao_sei_sem_fontes(monkeypatch):
    for q, reply in [
        ("E quem ganha a Copa?", "O Nexxus não fala sobre esportes ou assuntos fora do projeto."),
        ("Who can use this? How would a city use Nexxus?", "Nexxus does not have that information. I can talk about radar."),
        ("How would a city use Nexxus?", "Nexxus doesn't have that information."),
    ]:
        fake_model(monkeypatch, reply)
        a = run(core.ask(q))
        assert a.mode == "no_info" and not a.cards and not a.sources, f"{q} -> {a.mode} {a.cards}"
    # Resposta que cita cartão não é recusa, mesmo dizendo o que o Nexxus não tem.
    fake_model(monkeypatch, "Nexxus does not have that information for the whole valley, only about 53 km² of new open water [taquari].")
    assert run(core.ask("How big was the Taquari flood?")).mode == "model"


def test_cache_nao_separa_por_cena_a_pergunta_que_nao_e_sobre_ela(monkeypatch):
    import agent.main as m
    monkeypatch.setenv("GEMINI_API_KEY", "teste")
    chamadas = []

    async def gen(system, user):
        chamadas.append(1)
        return "NISAR flies 747 km up [nisar]."

    monkeypatch.setattr(llm, "generate", gen)
    c = TestClient(app)
    for cena in (None, "taquari", "campinas"):
        r = c.post("/api/ask", json={"question": "What is NISAR?", "lang": "en", "scene": cena})
        assert r.json()["mode"] == "model"
    assert len(chamadas) == 1
    # A pergunta que aponta para a cena continua com uma resposta por cena.
    assert m._chave("What changed here?", "en", "taquari") != m._chave("What changed here?", "en", "campinas")
