# Água aberta nova no baixo vale do Taquari (cheia de 22/07/2026), medida em cada passagem do NISAR GCOV de duas
# órbitas: a descendente 053_D_103 e a ascendente 103_A_163. Grava packages/contract/src/fixtures/taquari-water.json.
#
# Precisa do token do Earthdata no .env da raiz (EARTHDATA_TOKEN) e de internet na primeira vez: cerca de 30 s por
# passagem, 10 min nas 21 (medido em 14/11/2026). O recorte de cada passagem fica em scripts/.cache (fora do git);
# com ele a rodada seguinte leva segundos, só consulta o catálogo e não precisa do token. Rodar da raiz do
# repositório, só com Docker:
#   docker run --rm --env-file .env -v "$PWD:/repo" -w /repo python:3.12-slim sh -c "pip install -q numpy pillow scipy h5py fsspec aiohttp pyproj && python -B scripts/water_series.py"
# Com --selftest no fim (e sem --env-file), só confere as contas em matrizes sintéticas: sem rede, sem token, sem gravar.
#
# Método. O bbox, a órbita e as duas granules da cena vêm do manifest.json; as passagens das duas órbitas, do
# catálogo público da NASA (CMR). De cada passagem sai o recorte HH do gcov_crop.py (gamma0 médio em potência, grade
# lat/lon de 640 × 640 sobre o bbox), em dB. Passagem com menos de 99% dos pixels com dado fica de fora, em "skipped".
#   1. Referência de cada órbita: a mediana, pixel a pixel, dos dB das passagens dela até 21/07/2026 (rio baixo).
#      Uma passagem que é da referência é comparada com a mediana das outras e leva "reference": true: o valor dela
#      é o piso de ruído do método, não água. Com três passagens de referência por órbita, como aqui, a mediana
#      das outras duas é a média delas: menos firme que a mediana de três, que vale para as passagens seguintes.
#   2. Água aberta nova: a referência era terra (−14 dB ou mais), o HH caiu 3 dB ou mais e ficou abaixo do limiar de
#      água. O limiar principal é −12 dB (newWaterKm2); −14 e −10 dB dão a faixa (lowKm2 e highKm2).
#   3. Manchas com menos de 7 pixels (cerca de 1 ha), contando vizinho na diagonal, saem: nesse tamanho não dá
#      para separar água de ruído.
#   4. Área: soma da área de cada pixel marcado na esfera de raio 6371 km; os pixels da linha entre as latitudes
#      a e b têm R² · Δlon · |sen a − sen b|.
#   5. landShiftDb é a mediana de (dB − referência) onde a referência era terra. Só registro, não filtra nada:
#      solo molhado clareia a terra, e descartar por isso poderia tirar justamente a passagem da cheia.
# Trava: antes de ler as outras passagens, a regra simples por pixel entre as duas datas do manifest (caiu 3 dB ou
# mais e ficou abaixo do limiar; sem referência, sem filtro de manchas) tem de dar 58,2 ± 1,5 km² em −10 dB e
# 50,5 ± 1,5 km² em −14 dB, os valores medidos nos PNGs de 8 bits commitados. Fora disso o script para e não grava.
#
# Limites. É água aberta NOVA em relação ao rio baixo, não a área inundada: o leito normal já era escuro e não entra,
# água debaixo de árvores ou entre construções devolve sinal forte e não entra, mancha com menos de 1 ha não entra.
# Qualquer superfície lisa que escureça 3 dB entra como água (lavoura colhida ou recém-preparada, por exemplo): fora
# da cheia o número de uma passagem é teto, não medida, e o das passagens de referência mostra o tamanho do ruído.
# Vento encrespa a água e pode tirá-la da conta. As duas órbitas olham de lados opostos e em horas diferentes
# (a descendente perto das 18h30 e a ascendente perto das 6h20, hora local): comparar passagens da mesma órbita.
# SMOOTH = 3 faria a média 3 × 3 em potência antes do dB; fica em 1, porque a média só corrói as bordas das manchas.
#
# O token nunca é impresso nem gravado, e de uma falha de rede só sai o nome da classe do erro.
import datetime, json, os, sys, time, traceback, warnings
sys.dont_write_bytecode = True  # os scripts vizinhos entram como módulos: sem isso sobraria scripts/__pycache__
import numpy as np
from gcov_crop import SIZE, crop, h5_url, open_h5
from nisar_passagens import granules

SCENE = "taquari"
MANIFEST = "apps/api/scene-images/manifest.json"
OUT = "packages/contract/src/fixtures/taquari-water.json"
CACHE = "scripts/.cache"
OTHER_STACK = "103_A_163"       # a órbita ascendente (STACK_ID do NISAR, trilha 103); a da cena, descendente, vem do manifest
MIN_PASSES = 4                  # órbita com menos passagens que isso no catálogo: para
REFERENCE_UNTIL = "2026-07-21"  # véspera da cheia: até aqui o rio estava baixo
DROP_DB = 3                     # queda mínima do HH em relação à referência
REF_MIN_DB = -14                # a referência tem de ser terra: abaixo disso já era água ou sombra
THRESHOLDS_DB = {"low": -14, "main": -12, "high": -10}  # limiar de água: o principal e a faixa
MIN_PATCH_PX = 7                # manchas menores que isso (8 vizinhos) saem
SMOOTH = 1                      # 3 = média 3 × 3 em potência antes do dB
MIN_VALID_PCT = 99              # passagem com menos pixels com dado fica de fora
R_KM = 6371.0
GATE = {-10: 58.2, -14: 50.5}   # km² da regra simples entre as duas datas do manifest, medidos nos PNGs commitados
GATE_TOL = 1.5
TRIES = 3                       # tentativas de leitura por passagem


def row_areas(bbox, size=SIZE):
    """km² de um pixel de cada linha da grade lat/lon (linha 0 = norte), na esfera de raio R_KM."""
    w, s, e, n = bbox
    lat = np.radians(n - np.arange(size + 1) / size * (n - s))  # as bordas das linhas, do norte para o sul
    return R_KM ** 2 * np.radians((e - w) / size) * np.abs(np.sin(lat[:-1]) - np.sin(lat[1:]))


def to_db(g0, smooth=None):
    """gamma0 linear em dB (NaN sem dado). Com smooth > 1, antes a média smooth × smooth em potência dos pixels com dado."""
    smooth = SMOOTH if smooth is None else smooth
    g0 = np.asarray(g0, np.float64)
    if smooth > 1:
        from scipy.ndimage import uniform_filter
        ok = np.isfinite(g0)
        total = uniform_filter(np.where(ok, g0, 0.0), smooth, mode="constant")
        count = uniform_filter(ok.astype(np.float64), smooth, mode="constant")
        g0 = np.where(ok, total / np.maximum(count, 1e-12), np.nan)
    with np.errstate(divide="ignore", invalid="ignore"):
        return np.where(g0 > 0, 10 * np.log10(g0), np.nan)


def new_water(ref, db, threshold):
    """Água aberta nova: a referência era terra (REF_MIN_DB ou mais), o HH caiu DROP_DB ou mais e ficou abaixo do
    limiar. Pixel sem dado (NaN) na referência ou na passagem nunca entra."""
    with np.errstate(invalid="ignore"):
        return (ref >= REF_MIN_DB) & (ref - db >= DROP_DB) & (db < threshold)


def drop_small(mask, min_px=None):
    """A máscara sem as manchas de menos de min_px pixels; vizinho na diagonal conta como ligado (8 vizinhos)."""
    from scipy.ndimage import label
    labels, _ = label(mask, structure=np.ones((3, 3), int))
    keep = np.bincount(labels.ravel()) >= (MIN_PATCH_PX if min_px is None else min_px)
    keep[0] = False  # o rótulo 0 é o fundo
    return keep[labels]


def area_km2(mask, rows):
    """Área dos pixels marcados: quantos há em cada linha vezes a área do pixel daquela linha."""
    return float((mask.sum(axis=1) * rows).sum())


def reference_for(p, passes):
    """Referência de uma passagem: mediana por pixel dos dB das passagens de rio baixo (até REFERENCE_UNTIL) da mesma
    órbita, sem ela mesma. NaN onde nenhuma tem dado; None se não sobra passagem."""
    rest = [q["db"] for q in passes if q["stack"] == p["stack"] and q["date"] <= REFERENCE_UNTIL and q is not p]
    if not rest:
        return None
    with warnings.catch_warnings():
        warnings.simplefilter("ignore", RuntimeWarning)  # pixel sem dado em todas: fica NaN, sem aviso
        return np.nanmedian(np.stack(rest), axis=0)


def water_mask(p, ref, threshold):
    """A máscara de água aberta nova de uma passagem num limiar, já sem as manchas pequenas."""
    return drop_small(new_water(ref, p["db"], threshold))


def measure(p, ref, rows):
    """As medidas de uma passagem contra a referência dela, arredondadas como vão para o JSON."""
    km2 = {k: round(area_km2(water_mask(p, ref, t), rows), 1) for k, t in THRESHOLDS_DB.items()}
    with np.errstate(invalid="ignore"), warnings.catch_warnings():
        warnings.simplefilter("ignore", RuntimeWarning)
        shift = float(np.nanmedian((p["db"] - ref)[ref >= REF_MIN_DB]))  # só registro: não filtra nada
    return {"landShiftDb": round(shift, 2) + 0.0, "reference": p["date"] <= REFERENCE_UNTIL,  # + 0.0: sem "-0.0"
            "newWaterKm2": km2["main"], "lowKm2": km2["low"], "highKm2": km2["high"]}


def gate(before, after, rows):
    """A trava: regra simples por pixel entre duas datas (caiu DROP_DB ou mais e ficou abaixo do limiar), sem
    referência, sem filtro de manchas e sem suavizar. Devolve os km² em cada limiar de GATE."""
    b, a = to_db(before, 1), to_db(after, 1)
    with np.errstate(invalid="ignore"):
        return {t: area_km2((b - a >= DROP_DB) & (a < t), rows) for t in GATE}


def cache_path(p):
    return os.path.join(CACHE, f"{SCENE}-{p['stack']}-{p['date']}.npz")


def load_hh(p, bbox):
    """gamma0 HH da passagem na grade do bbox (float32, NaN sem dado) e se veio do cache. O cache só vale se for
    desta granule e deste bbox; senão lê do arquivo GCOV e guarda."""
    path = cache_path(p)
    try:
        with np.load(path) as z:
            if str(z["granule"]) == p["granule"] and z["bbox"].tolist() == list(bbox) and z["HH"].shape == (SIZE, SIZE):
                return z["HH"].astype(np.float32), True
    except Exception:  # noqa: BLE001  (sem cache, ou cache ilegível: lê de novo)
        pass
    if not os.environ.get("EARTHDATA_TOKEN", "").strip().strip('"').strip("'"):
        sys.exit(f"{p['date']} {p['stack']} fora do cache e EARTHDATA_TOKEN vazio: defina no .env da raiz e rode com --env-file .env")
    url = h5_url(p["granule"])
    f, fs = open_h5(url)
    try:
        hh = crop(f, fs, url, bbox, ["HH"])["HH"].astype(np.float32)
    finally:
        f.close()
    os.makedirs(CACHE, exist_ok=True)
    np.savez_compressed(path + ".tmp.npz", HH=hh, bbox=np.array(bbox, np.float64), granule=np.array(p["granule"]))
    os.replace(path + ".tmp.npz", path)  # troca de uma vez: rodada interrompida não deixa cache pela metade
    return hh, False


def fetch(p, bbox):
    """load_hh com TRIES tentativas: devolve (gamma0, veio do cache, None) ou (None, False, motivo). Do erro só sai o
    nome da classe: a mensagem de uma falha de rede pode trazer o cabeçalho com o token."""
    for attempt in range(TRIES):
        try:
            return (*load_hh(p, bbox), None)
        except Exception as e:  # noqa: BLE001
            if str(e) == "o bbox sai da grade do arquivo":  # mensagem do próprio gcov_crop.py: tentar de novo não muda
                return None, False, "bbox outside the file grid"
            name = type(e).__name__
            print(f"  {p['date']} {p['stack']}: tentativa {attempt + 1} de {TRIES} falhou ({name})", flush=True)
            if attempt + 1 < TRIES:
                time.sleep(10 * (attempt + 1))
    return None, False, f"download failed ({name})"


def list_passes(lat, lon, stacks):
    """Passagens das órbitas pedidas sobre o ponto, do catálogo público da NASA (CMR), por data e órbita. Para se
    uma data tiver duas granules na mesma órbita ou se uma órbita tiver menos de MIN_PASSES passagens."""
    for attempt in range(TRIES):
        try:
            found = granules(lat, lon)
            break
        except Exception as e:  # noqa: BLE001
            name = type(e).__name__
            time.sleep(5 if attempt + 1 < TRIES else 0)
    else:
        sys.exit(f"o catálogo (CMR) não respondeu: {name}")
    by_id = {g["id"]: g for g in found if g["stack"] in stacks}  # a mesma granule listada duas vezes conta uma
    passes = sorted(({"stack": g["stack"], "direction": g["dir"].lower(), "track": int(g["track"]), "date": g["date"],
                      "granule": g["id"], "pol": g["pol"]} for g in by_id.values()), key=lambda p: (p["date"], p["stack"]))
    keys = [(p["date"], p["stack"]) for p in passes]
    twice = sorted({k for k in keys if keys.count(k) > 1})
    if twice:
        sys.exit("duas granules na mesma data e órbita: " + ", ".join(f"{d} {s}" for d, s in twice))
    for s in stacks:
        n = sum(p["stack"] == s for p in passes)
        if n < MIN_PASSES:
            sys.exit(f"órbita {s} com {n} passagens no catálogo (mínimo {MIN_PASSES})")
    if any(p["direction"] not in ("ascending", "descending") for p in passes):
        sys.exit("o catálogo não diz a direção (ASCENDING_DESCENDING) de alguma passagem")
    return passes


def main():
    with open(MANIFEST, encoding="utf-8") as f:
        m = json.load(f)["scenes"][SCENE]
    bbox, rows, stacks = m["bbox"], row_areas(m["bbox"]), [m["stack"], OTHER_STACK]
    passes = list_passes(*m["center"], stacks)
    print(f"{len(passes)} passagens no catálogo: " + ", ".join(f"{s} {sum(p['stack'] == s for p in passes)}" for s in stacks), flush=True)
    pair = [next((p for p in passes if p["granule"] == m[when]["granule"] and p["stack"] == m["stack"]), None) for when in ("before", "after")]
    if None in pair:
        sys.exit("uma das duas granules do manifest não está entre as passagens do catálogo: a trava não tem como rodar")

    def ingest(p):
        """Lê a passagem e guarda nela o gamma0, os dB e a parte com dado; devolve o motivo de ela ficar de fora, ou None."""
        if "HH" not in p["pol"].split("+"):
            return "no HH in the product"
        t = time.time()
        hh, cached, why = fetch(p, bbox)
        if hh is None:
            return why
        valid = float(np.isfinite(hh).mean()) * 100
        print(f"  {p['date']} {p['stack']}: {valid:.1f}% com dado, " + ("do cache" if cached else f"{time.time() - t:.0f} s"), flush=True)
        if valid < MIN_VALID_PCT:
            return f"{valid:.2f}% of the pixels have data, under {MIN_VALID_PCT}%"
        p.update(hh=hh, db=to_db(hh), validPct=round(valid, 1))
        return None

    # as duas datas do manifest primeiro: se a trava falhar, o script para antes de ler as outras passagens
    for p in pair:
        why = ingest(p)
        if why:
            sys.exit(f"{p['date']} (granule do manifest) ficou de fora: {why}. A trava não tem como rodar")
    got = gate(pair[0]["hh"], pair[1]["hh"], rows)
    print(f"trava, {pair[0]['date']} contra {pair[1]['date']}, regra simples por pixel: "
          + "; ".join(f"{got[t]:.1f} km² em {t} dB (esperado {GATE[t]} ± {GATE_TOL})" for t in GATE), flush=True)
    if any(abs(got[t] - GATE[t]) > GATE_TOL for t in GATE):
        sys.exit("trava: fora da faixa. O recorte, a grade ou a calibração mudaram: nada foi gravado")

    skipped = []
    for p in passes:
        if "db" not in p:
            why = ingest(p)
            if why:
                skipped.append({"stack": p["stack"], "date": p["date"], "granule": p["granule"], "reason": why})
    good = [p for p in passes if "db" in p]
    for s in stacks:
        n = sum(p["stack"] == s and p["date"] <= REFERENCE_UNTIL for p in good)
        if not n:
            sys.exit(f"órbita {s} sem passagem de rio baixo (até {REFERENCE_UNTIL}) com dado: não há referência")
        if n < 2:
            print(f"aviso: órbita {s} com uma só passagem de rio baixo: ela fica de fora e não há piso de ruído medido")
    measured = []
    for p in good:  # já em ordem de data e órbita
        ref = reference_for(p, good)
        if ref is None:
            skipped.append({"stack": p["stack"], "date": p["date"], "granule": p["granule"],
                            "reason": "only low-water pass of its orbit: no reference to compare it with"})
            continue
        measured.append({**{k: p[k] for k in ("stack", "direction", "track", "date", "granule", "validPct")}, **measure(p, ref, rows)})
    skipped.sort(key=lambda q: (q["date"], q["stack"]))

    out = {"scene": SCENE, "bbox": bbox, "generated": datetime.datetime.now(datetime.timezone.utc).date().isoformat(),
           "parameters": {"polarization": "HH", "referenceUntil": REFERENCE_UNTIL, "dropDb": DROP_DB, "refMinDb": REF_MIN_DB,
                          "thresholdsDb": THRESHOLDS_DB, "minPatchPx": MIN_PATCH_PX, "smooth": SMOOTH, "minValidPct": MIN_VALID_PCT},
           "passes": measured, "skipped": skipped}
    text = json.dumps(out, ensure_ascii=False, indent=1, allow_nan=False)  # NaN não é JSON: para aqui em vez de gravar
    with open(OUT, "w", encoding="utf-8") as f:
        f.write(text)
    print("data        órbita     com dado  terra dB  ref   km²: " + "  ".join(f"{t:>4} dB" for t in THRESHOLDS_DB.values()))
    for q in measured:
        print(f"{q['date']}  {q['stack']}  {q['validPct']:7.1f}  {q['landShiftDb']:+8.2f}  {'sim' if q['reference'] else '   '}"
              f"       {q['lowKm2']:7.1f}  {q['newWaterKm2']:7.1f}  {q['highKm2']:7.1f}")
    for q in skipped:
        print(f"de fora: {q['date']} {q['stack']}: {q['reason']}")
    print(f"{OUT}: {len(measured)} passagens medidas, {len(skipped)} de fora")


def selftest():
    """Confere as contas em matrizes sintéticas: sem rede, sem token, sem cache, sem gravar nada."""
    def check(ok, what):
        if not ok:
            sys.exit(f"selftest FALHOU: {what}")

    # 1. a regra da máscara nos limites: >= na referência e na queda, < no limiar, NaN nunca entra
    cases = [  # referência, passagem, água em −14, em −12, em −10
        (-8, -15, 1, 1, 1), (-8, -14, 0, 1, 1), (-8, -13, 0, 1, 1), (-8, -12, 0, 0, 1), (-8, -11, 0, 0, 1),
        (-8, -10.5, 0, 0, 0),   # abaixo de −10, mas caiu só 2,5 dB
        (-7, -10, 0, 0, 0),     # caiu 3 dB, mas −10 não é menor que −10
        (-14, -17, 1, 1, 1),    # referência de exatamente −14 dB ainda é terra
        (-14.5, -19, 0, 0, 0),  # a referência já era água ou sombra
        (-9, -12.5, 0, 1, 1), (-10, -12.5, 0, 0, 0), (np.nan, -20, 0, 0, 0), (-8, np.nan, 0, 0, 0)]
    ref, db = (np.array([c[i] for c in cases], float).reshape(1, -1) for i in (0, 1))
    for k, t in enumerate((-14, -12, -10)):
        check(new_water(ref, db, t).ravel().tolist() == [bool(c[2 + k]) for c in cases], f"regra da máscara em {t} dB")
    check(list(THRESHOLDS_DB.values()) == [-14, -12, -10] and (DROP_DB, REF_MIN_DB, MIN_PATCH_PX, MIN_VALID_PCT) == (3, -14, 7, 99)
          and REFERENCE_UNTIL == "2026-07-21" and R_KM == 6371.0, "parâmetros do método")

    # 2. filtro de manchas: 6 pixels saem, 7 ficam, e a diagonal liga
    mask, keep = np.zeros((40, 40), bool), np.zeros((40, 40), bool)
    mask[1:3, 1:4] = True                             # bloco de 6: sai
    mask[1:3, 10:13] = mask[3, 10] = True             # bloco de 6 mais 1 encostado: 7, fica
    keep[1:3, 10:13] = keep[3, 10] = True
    for i in range(7):                                # diagonal de 7: fica só porque a diagonal liga
        mask[10 + i, 1 + i] = keep[10 + i, 1 + i] = True
    for i in range(6):                                # diagonal de 6: sai
        mask[10 + i, 20 + i] = True
    mask[25:27, 1:3] = mask[27, 3:6] = True           # 4 e 3 que só se tocam pelo canto: 7, fica
    keep[25:27, 1:3] = keep[27, 3:6] = True
    mask[25:27, 20:22] = mask[27, 23:26] = True       # 4 e 3 com um pixel de vão: duas manchas, saem
    check(np.array_equal(drop_small(mask), keep), "filtro de manchas (6 sai, 7 fica, diagonal liga)")
    check(not drop_small(np.zeros((5, 5), bool)).any() and drop_small(np.ones((3, 3), bool)).all(), "filtro de manchas nos extremos")

    # 3. referência: mediana das passagens de rio baixo da mesma órbita, sem a própria passagem
    def fake(stack, date, value):
        return {"stack": stack, "date": date, "db": np.full((4, 4), float(value))}
    a, b, c = fake("S1", "2026-06-01", -8), fake("S1", "2026-06-13", -9), fake("S1", REFERENCE_UNTIL, -13)
    d, other = fake("S1", "2026-07-22", -20), fake("S2", "2026-06-05", -30)
    b["db"][0, 0] = np.nan
    stack = [a, b, c, d, other]
    for p, want, corner in ((d, -9, -10.5), (a, -11, -13), (b, -10.5, -10.5), (c, -8.5, -8), (other, None, None)):
        got = reference_for(p, stack)
        if want is None:
            check(got is None, "passagem de rio baixo sozinha na órbita não tem referência")
        else:
            check(got[1, 1] == want and got[0, 0] == corner, f"referência de {p['date']} (sem ela mesma, sem NaN, só a própria órbita)")
    a["db"][2, 2] = b["db"][2, 2] = c["db"][2, 2] = np.nan
    check(np.isnan(reference_for(d, stack)[2, 2]), "pixel sem dado em toda a referência fica NaN")

    # 4. área: as linhas somadas dão R² · Δlon · (sen n − sen s), nos dois hemisférios e sobre o equador
    for box in ([-51.94336, -29.84064, -51.67969, -29.61167], [10.0, 40.0, 11.5, 41.0], [-1.0, -0.5, 1.0, 0.75]):
        w, s, e, n = box
        rows = row_areas(box)
        whole = R_KM ** 2 * np.radians(e - w) * (np.sin(np.radians(n)) - np.sin(np.radians(s)))
        check(rows.shape == (SIZE,) and (rows > 0).all() and np.isclose(rows.sum() * SIZE, whole, rtol=1e-9, atol=0), f"área do bbox {box}")
        check(np.isclose(area_km2(np.ones((SIZE, SIZE), bool), rows), whole, rtol=1e-9, atol=0), "área da máscara cheia")
        check(area_km2(np.zeros((SIZE, SIZE), bool), rows) == 0, "área da máscara vazia")
    rows = row_areas([-51.94336, -29.84064, -51.67969, -29.61167])
    check(rows[0] > rows[-1] and abs(rows.sum() * SIZE - 648.2334) < 1e-3, "bbox do Taquari: 648,2 km², pixel maior ao norte")

    # 5. dB e suavização: 3 × 3 em potência, só com os pixels com dado
    g0 = np.ones((5, 5))
    g0[2, 2], g0[4, 4], g0[0, 4] = 10, 0, np.nan
    plain, soft = to_db(g0, 1), to_db(g0, 3)
    check(plain[2, 2] == 10 and plain[0, 0] == 0 and np.isnan(plain[4, 4]) and np.isnan(plain[0, 4]), "dB sem suavizar")
    check(np.isclose(soft[2, 2], 10 * np.log10(18 / 9)) and np.isclose(soft[0, 0], 0) and np.isclose(soft[1, 1], 10 * np.log10(18 / 9)), "média 3 × 3 em potência")
    check(np.isnan(soft[0, 4]) and np.isclose(soft[0, 3], 0) and np.isclose(soft[3, 3], 10 * np.log10(17 / 9)), "média 3 × 3 ao lado de pixel sem dado")
    check(SMOOTH == 1 and np.array_equal(to_db(g0), plain, equal_nan=True), "SMOOTH fica em 1")

    # 6. uma órbita inteira: água que já era água não conta nem quando escurece, a cheia conta, o ruído pequeno sai
    rows = row_areas([-52.0, -30.0, -51.75, -29.75], 64)
    def scene(date, flood=None, land=-8.0, water=-18.0):
        db = np.full((64, 64), land)
        db[:, :40] = water                            # água permanente, mais da metade da imagem
        if flood:
            db[10:20, 44:54] = flood                  # 100 pixels de várzea alagada
            db[40, 45:48] = flood                     # 3 pixels soltos: ruído
        return {"stack": "S1", "date": date, "db": db}
    orbit = [scene("2026-06-01"), scene("2026-06-13"), scene("2026-07-01"), scene("2026-07-23", -13.0, -7.5, -22.0), scene("2026-08-04", land=-8.25)]
    res = [measure(p, reference_for(p, orbit), rows) for p in orbit]
    block = float(rows[10:20].sum() * 10)
    check([r["reference"] for r in res] == [True, True, True, False, False], "quais passagens são de referência")
    check(all(r["newWaterKm2"] == r["lowKm2"] == r["highKm2"] == 0 for r in res[:3] + res[4:]), "sem cheia, zero água nova")
    check(res[3]["lowKm2"] == 0 and res[3]["newWaterKm2"] == res[3]["highKm2"] == round(block, 1) > 0, "cheia de −13 dB: entra em −12 e −10, não em −14")
    check(res[3]["landShiftDb"] == 0.5 and res[4]["landShiftDb"] == -0.25 and res[0]["landShiftDb"] == 0, "landShiftDb só na terra da referência")
    want = np.zeros((64, 64), bool)
    want[10:20, 44:54] = True
    check(np.array_equal(water_mask(orbit[3], reference_for(orbit[3], orbit), -12), want), "a máscara é o bloco alagado e só ele")

    # 7. a trava é a regra simples: sem referência (água que já era água conta) e sem filtro (1 pixel conta)
    before, after = np.full((64, 64), 10 ** -0.8), np.full((64, 64), 10 ** -0.8)
    before[0, 0], after[0, 0] = 10 ** -1.6, 10 ** -2.0  # já era água e escureceu 4 dB: conta em −10 e em −14
    after[5, 5] = 10 ** -1.2                            # terra que caiu 4 dB, para −12: conta só em −10
    got = gate(before, after, rows)
    check(np.isclose(got[-10], rows[0] + rows[5]) and np.isclose(got[-14], rows[0]), "trava: regra simples por pixel")
    print("selftest ok: regra da máscara, filtro de manchas, referência sem a própria passagem, área, dB e suavização, órbita sintética, trava")


if __name__ == "__main__":
    if sys.argv[1:] == ["--selftest"]:
        selftest()
    elif sys.argv[1:]:
        sys.exit("uso: python -B scripts/water_series.py [--selftest]")
    else:
        try:
            main()
        except Exception as e:  # noqa: BLE001  (nunca a mensagem: a de uma falha de rede pode trazer o token)
            here = [f"{os.path.basename(fr.filename)}:{fr.lineno}" for fr in traceback.extract_tb(e.__traceback__)][-3:]
            sys.exit(f"falhou: {type(e).__name__} em {' > '.join(here)}")
