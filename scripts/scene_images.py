# Imagens reais das cenas: par antes/depois a partir do preview (_LATLON.png) do NISAR GCOV, público; o token do Earthdata só melhora a posição.
#
# Rodar da raiz do repositório, só com Docker (baixa cerca de 5 MB por imagem, 2 por cena):
#   docker run --rm --env-file .env -v "$PWD:/repo" -w /repo python:3.12-slim sh -c "pip install -q numpy pillow && python scripts/scene_images.py"
# Uma cena só: acrescente o id no fim (... scripts/scene_images.py sindh).
#
# Para cada cena: consulta o catálogo público da NASA (CMR) no centro, escolhe uma órbita (STACK_ID) e duas
# datas dela, posiciona cada preview no mapa, recorta o mesmo bbox nas duas, alinha a de depois na de antes e grava uma imagem
# em tons de cinza por polarização: apps/api/scene-images/<id>/before-HH.png, before-HV.png, after-HH.png e
# after-HV.png (no preview HH+HV, vermelho e azul são HH e verde é HV; no HH puro, os três canais são HH).
# O manifest.json guarda órbita, datas, bbox e polarizações; a API usa tudo isso junto com as imagens.
#
# Escolha automática: a órbita com o maior recorte possível; nela, as duas datas mais distantes desde SINCE com a
# mesma polarização e pelo menos 98% do recorte com dado.
# Alguns previews vêm com defeito (listras largas, como Lábrea em 25/06, 07/07 e 19/07): olhe os PNGs gerados
# e, se precisar, fixe stack, before e after da cena em SCENES.
#
# Posição: com EARTHDATA_TOKEN no .env, cada preview é posicionado pelo KML oficial que o acompanha (_LATLON.kml,
# os quatro cantos da imagem; só abre com login). Sem o token, pelo contorno do quadro no catálogo, que erra
# quando o contorno passa da borda da imagem: em Maceió a passagem de antes ficou 8 km fora do lugar.
# Alinhamento: depois de recortar, a correlação de fase (Fourier) mede quanto a imagem de depois está deslocada
# em relação à de antes, com fração de pixel, e a de depois é recortada de novo no lugar certo. O manifest guarda
# a correção e o que sobrou. Com o KML, as datas da mesma órbita já caem na mesma grade (sobra 0,01 pixel) e o
# alinhamento só confere. Desvio maior que MAX_SHIFT faz a cena falhar; "align": False em SCENES desliga o
# alinhamento numa cena. Cena que falha (rede, KML, desvio) fica com as imagens e o manifest que já tinha, e sem o
# token o script não troca uma cena posicionada pelo KML (ou vinda do GCOV) por uma posicionada pelo contorno.
#
# Limites: o preview é 8 bits com contraste esticado, cada data por conta própria. Serve para ver e para
# mudança relativa, não para valores em dB. O brilho não é ajustado entre as datas. Para imagem calibrada,
# rode depois scripts/gcov_crop.py na cena (precisa do token do Earthdata); sem nome de cena, este script
# não mexe nas cenas que já vêm do GCOV. Pixel do preview: uns 170 m.
import io, json, math, os, re, sys, time, urllib.parse, urllib.request
from datetime import date
import numpy as np
from PIL import Image

COLLECTIONS = ["C3622241360-ASF", "C2854338529-ASF", "C3622214170-ASF"]  # validada, provisória, beta
OUT = "apps/api/scene-images"
SIZE = 640          # pixels do recorte; com meia largura de 0,5° fica perto da resolução do preview
MAX_HALF = 0.5      # meia largura máxima do recorte, em graus
MIN_HALF = 0.2      # abaixo disso a cena fica com a imagem de exemplo
MIN_VALID = 0.98    # fração mínima de pixels com dado nas duas imagens
SINCE = "2026-06-01"  # quase não há dado do NISAR entre fevereiro e meados de junho de 2026
MAX_SHIFT = 8.0     # desvio entre as datas, em pixels do recorte, acima do qual o alinhamento não corrige
ALIGN_TOL = 0.15    # desvio que sobra aceito depois de alinhar, em pixels do recorte

# Centro de cada cena: o mesmo de packages/contract/src/fixtures/scenes.ts. Mudou lá, mude aqui
# (a API recusa as imagens se o centro do manifest não bater com o da cena).
# Opcional por cena: stack, before e after fixam a órbita e as datas em vez da escolha automática; bbox fixa o
# recorte ([oeste, sul, leste, norte]) em vez do quadrado em volta do centro.
SCENES = {
    # enchente de 22/07/2026: a passagem anterior e a da noite seguinte; recorte do baixo vale (650 km²)
    # `earlier`: passagens anteriores da mesma órbita, só para o gcov_crop.py (série com mais de duas datas na API)
    "taquari":    {"lat": -29.726, "lon": -51.812, "stack": "053_D_103", "before": "2026-07-11", "after": "2026-07-23",
                   "bbox": [-51.94336, -29.84064, -51.67969, -29.61167], "earlier": ["2026-06-17", "2026-06-29"]},
    # as demais: datas da escolha automática 6, fixadas para a fixture e os textos continuarem valendo
    "sindh":      {"lat": 26.0,  "lon": 68.5, "stack": "041_A_015", "before": "2026-06-17", "after": "2026-09-09"},
    "labrea":     {"lat": -7.3,  "lon": -64.8, "stack": "161_A_174", "before": "2026-08-24", "after": "2026-10-23"},  # previews de 25/06 a 19/07 listrados
    "jakobshavn": {"lat": 69.2,  "lon": -49.8, "stack": "131_A_037", "before": "2026-06-23", "after": "2026-11-02"},
    "pantanal":   {"lat": -18.5, "lon": -57.2, "stack": "132_A_168", "before": "2026-07-17", "after": "2026-10-21"},
    "kalimantan": {"lat": -0.5,  "lon": 113.5, "stack": "061_D_089", "before": "2026-06-30", "after": "2026-10-28"},
    "gelo-sul":   {"lat": -49.3, "lon": -73.2, "stack": "032_A_153", "before": "2026-06-28", "after": "2026-10-26"},
    "maceio":     {"lat": -9.6,  "lon": -35.7, "stack": "139_D_093", "before": "2026-06-23", "after": "2026-10-21"},
    "campinas":   {"lat": -23.0, "lon": -47.1, "stack": "024_D_100", "before": "2026-06-27", "after": "2026-11-06"},
    # cheia do Limpopo em janeiro de 2026 (NASA SVS 5661): passagem de antes e passagem durante a cheia. Essas datas são
    # da coleção beta, sem preview _LATLON: este script não gera a cena; o gcov_crop.py gera, direto do arquivo GCOV
    "chokwe":     {"lat": -24.53, "lon": 33.0, "stack": "114_A_165", "before": "2026-01-05", "after": "2026-01-17",
                   "bbox": [32.67, -24.83, 33.33, -24.23]},
}

CHANNEL = {"HH": 0, "HV": 1}  # canal do preview RGB de cada polarização


def fetch(req, timeout):
    """Bytes de um endereço, com até 3 tentativas: o CMR e o ASF às vezes cortam a resposta no meio."""
    for attempt in range(3):
        try:
            with urllib.request.urlopen(req, timeout=timeout) as r:
                return r.read()
        except Exception as e:
            if attempt == 2:
                raise
            print(f"  download falhou ({type(e).__name__}), tentando de novo")
            time.sleep(2 * (attempt + 1))


def granules(lat, lon):
    """Granules com preview sobre o ponto, uma por órbita e data (vale a coleção mais confiável)."""
    seen = {}
    for c in COLLECTIONS:
        q = urllib.parse.urlencode({"collection_concept_id": c, "point": f"{lon},{lat}", "page_size": 200, "sort_key": "-start_date"})
        items = json.loads(fetch("https://cmr.earthdata.nasa.gov/search/granules.umm_json?" + q, 60))["items"]
        for it in items:
            u = it["umm"]
            aa = {a["Name"]: a["Values"][0] for a in u.get("AdditionalAttributes", [])}
            browse = [x["URL"] for x in u.get("RelatedUrls", []) if x["URL"].startswith("https") and x["URL"].endswith("_LATLON.png")]
            kml = [x["URL"] for x in u.get("RelatedUrls", []) if x["URL"].startswith("https") and x["URL"].endswith("_LATLON.kml")]
            if not browse or "STACK_ID" not in aa:
                continue
            pts = u["SpatialExtent"]["HorizontalSpatialDomain"]["Geometry"]["GPolygons"][0]["Boundary"]["Points"]
            g = {"id": u["GranuleUR"], "date": u["TemporalExtent"]["RangeDateTime"]["BeginningDateTime"][:10],
                 "stack": aa["STACK_ID"], "pol": aa.get("FREQUENCY_A_POLARIZATION_CONCAT", "?"),
                 "poly": [(p["Longitude"], p["Latitude"]) for p in pts], "browse": browse[0], "kml": kml[0] if kml else None}
            seen.setdefault((g["stack"], g["date"]), g)
    return list(seen.values())


def inside(x, y, poly):
    c = False
    for i in range(len(poly)):
        (x1, y1), (x2, y2) = poly[i], poly[(i + 1) % len(poly)]
        if (y1 > y) != (y2 > y) and x < (x2 - x1) * (y - y1) / (y2 - y1) + x1:
            c = not c
    return c


def fit(lat, lon, poly):
    """Maior meia largura (passo de 0,05°) cujo quadrado em volta do centro cabe no contorno do quadro."""
    h = 0.0
    for k in range(1, int(MAX_HALF / 0.05) + 1):
        hh = round(k * 0.05, 2)
        if all(inside(lon + dx * hh, lat + dy * hh, poly) for dx in (-1, 0, 1) for dy in (-1, 0, 1)):
            h = hh
        else:
            break
    return h


def candidates(cfg, gs):
    """Por órbita e polarização, as datas desde SINCE, em ordem. Fixando stack/before/after, só elas (e sem o SINCE:
    data fixada vale mesmo anterior, como a cheia de Chókwè em janeiro de 2026)."""
    groups = {}
    for g in gs:
        if g["date"] >= SINCE or cfg.get("stack"):
            groups.setdefault((g["stack"], g["pol"]), []).append(g)
    if cfg.get("stack"):
        out = []
        for (stack, pol), l in groups.items():
            d = {g["date"]: g for g in l}
            if stack == cfg["stack"] and cfg["before"] in d and cfg["after"] in d:
                out.append((d[cfg["before"]], d[cfg["after"]], [d[cfg["before"]], d[cfg["after"]]]))
        if not out:
            raise RuntimeError(f"{cfg['stack']} sem preview de mesma polarização em {cfg['before']} e {cfg['after']}")
        return out
    out = []
    for l in groups.values():
        if len(l) >= 2:
            l.sort(key=lambda g: g["date"])
            out.append((l[0], l[-1], l))
    if not out:
        raise RuntimeError("nenhuma órbita com duas datas de mesma polarização desde " + SINCE)
    return out


def token():
    return os.environ.get("EARTHDATA_TOKEN", "").strip().strip('"').strip("'")  # --env-file não tira aspas


def kml_box(g):
    """Oeste, leste, sul e norte da imagem pelo _LATLON.kml oficial; None sem token. Com token, KML que não abre
    faz a cena falhar: misturar uma data pelo KML com outra pelo contorno põe as duas fora do lugar."""
    if not token():
        return None
    if not g.get("kml"):
        raise RuntimeError(f"{g['date']} sem _LATLON.kml no catálogo")
    try:
        text = fetch(urllib.request.Request(g["kml"], headers={"Authorization": "Bearer " + token()}), 60).decode()
        pts = [tuple(map(float, p.split(",")[:2])) for p in re.search(r"<coordinates>(.*?)</coordinates>", text, re.S).group(1).split()]
    except Exception as e:
        raise RuntimeError(f"KML de {g['date']} não abriu ({type(e).__name__}; token vencido?)") from None
    lons, lats = sorted({round(x, 6) for x, _ in pts}), sorted({round(y, 6) for _, y in pts})
    if len(pts) != 4 or len(lons) != 2 or len(lats) != 2:  # só sabe usar um retângulo em lat/lon
        raise RuntimeError(f"KML de {g['date']} não é um retângulo em lat/lon")
    return lons[0], lons[1], lats[0], lats[1]


def load(g):
    """Imagem RGB e a posição dela: bordas em pixel (x0, x1, y0, y1) que correspondem a (oeste, leste, sul, norte)."""
    a = np.asarray(Image.open(io.BytesIO(fetch(g["browse"], 180))).convert("RGB"))
    box = kml_box(g)
    if box:  # o KML descreve a imagem inteira, de borda a borda
        return a, (0, a.shape[1], 0, a.shape[0]), box, "kml"
    v = a.sum(2) > 0
    ys, xs = np.where(v.any(1))[0], np.where(v.any(0))[0]
    lons, lats = [p[0] for p in g["poly"]], [p[1] for p in g["poly"]]
    return a, (xs[0], xs[-1], ys[0], ys[-1]), (min(lons), max(lons), min(lats), max(lats)), "contorno"


def crop(a, px, geo, kind, bbox):
    """Recorte do bbox em SIZE x SIZE, com fração de pixel; fora da imagem fica preto (sem dado)."""
    w, s, e, n = bbox
    fx = lambda lon: px[0] + (lon - geo[0]) / (geo[1] - geo[0]) * (px[1] - px[0])
    fy = lambda lat: px[2] + (geo[3] - lat) / (geo[3] - geo[2]) * (px[3] - px[2])
    x0, y0, x1, y1 = fx(w), fy(n), fx(e), fy(s)
    i0, j0, i1, j1 = math.floor(x0) - 2, math.floor(y0) - 2, math.ceil(x1) + 2, math.ceil(y1) + 2
    sub = Image.fromarray(a).crop((i0, j0, i1, j1))  # crop completa com preto o que sai da imagem
    out = sub.resize((SIZE, SIZE), Image.LANCZOS, box=(x0 - i0, y0 - j0, x1 - i0, y1 - j0))
    return np.asarray(out).astype(np.float32)


def phase_shift(a, b):
    """Quanto o conteúdo de b está deslocado em relação ao de a (dx para a direita, dy para baixo), em pixels com
    fração, por correlação de fase: o espectro cruzado normalizado vira um pico no ponto do deslocamento, e uma
    parábola em volta do pico dá a fração. Devolve também a nitidez do pico (pico sobre a média)."""
    h = np.hanning(a.shape[0])[:, None] * np.hanning(a.shape[1])[None, :]
    R = np.fft.fft2((a - a.mean()) * h) * np.conj(np.fft.fft2((b - b.mean()) * h))
    c = np.fft.fftshift(np.abs(np.fft.ifft2(R / (np.abs(R) + 1e-9))))
    py, px = np.unravel_index(np.argmax(c), c.shape)

    def frac(v0, v1, v2):
        d = v0 - 2 * v1 + v2
        return 0.0 if d == 0 else 0.5 * (v0 - v2) / d

    oy = frac(c[py - 1, px], c[py, px], c[py + 1, px]) if 0 < py < c.shape[0] - 1 else 0.0
    ox = frac(c[py, px - 1], c[py, px], c[py, px + 1]) if 0 < px < c.shape[1] - 1 else 0.0
    return -(px + ox - c.shape[1] // 2), -(py + oy - c.shape[0] // 2), float(c[py, px] / (c.mean() + 1e-9))


def align(name, cfg, img, bbox, x, y):
    """Recorta de novo a imagem de depois para casar com a de antes. Devolve o recorte e o registro do manifest."""
    if cfg.get("align") is False:
        print(f"  {name}: alinhamento desligado em SCENES")
        return y, {"applied": False, "reason": "desligado em SCENES"}
    w, s, e, n = bbox
    pw, ph = (e - w) / SIZE, (n - s) / SIZE  # graus por pixel do recorte
    dx, dy, peak = phase_shift(x[..., 0], y[..., 0])  # canal HH
    first = {"dx": round(dx, 2), "dy": round(dy, 2), "peak": round(peak)}
    if math.hypot(dx, dy) > MAX_SHIFT:
        raise RuntimeError(f"datas desviadas {dx:+.2f}, {dy:+.2f} px, acima de {MAX_SHIFT}: posição errada (sem token?)")
    tx = ty = 0.0
    for _ in range(3):  # o recorte de novo muda um pouco a medida: repete até sobrar menos que ALIGN_TOL
        if math.hypot(dx, dy) < ALIGN_TOL:
            break
        tx, ty = tx + dx, ty + dy
        # conteúdo de depois deslocado para a direita e para baixo: a janela anda para leste e para o sul
        y = crop(*img, [w + tx * pw, s - ty * ph, e + tx * pw, n - ty * ph])
        dx, dy, peak = phase_shift(x[..., 0], y[..., 0])
    rest = math.hypot(dx, dy)
    print(f"  {name}: depois deslocada {first['dx']:+.2f}, {first['dy']:+.2f} px (pico {first['peak']}); "
          f"corrigida {tx:+.2f}, {ty:+.2f}; sobra {rest:.2f} px")
    return y, {"applied": True, "dx": round(tx, 2), "dy": round(ty, 2), "residual": round(rest, 2),
               "peak": round(peak), "units": f"pixels de {SIZE}"}


def run(name, cfg):
    lat, lon = cfg["lat"], cfg["lon"]
    groups = candidates(cfg, granules(lat, lon))
    # maior recorte primeiro; empate, a órbita com mais datas
    groups.sort(key=lambda c: (min(fit(lat, lon, c[0]["poly"]), fit(lat, lon, c[1]["poly"])), len(c[2])), reverse=True)
    _, _, dates = groups[0]
    half = min(fit(lat, lon, g["poly"]) for g in dates[:1] + dates[-1:])
    fixed = cfg.get("bbox")
    if fixed:
        w, s_, e, n = fixed
        if not all(inside(x, y, g["poly"]) for g in dates for x in (w, e) for y in (s_, n)):
            raise RuntimeError(f"o bbox fixo sai do quadro de {dates[0]['stack']}")
        half = MIN_HALF  # uma tentativa só, com o bbox fixo
    elif half < MIN_HALF:
        raise RuntimeError(f"o quadro de {dates[0]['stack']} cobre só ±{half}° em volta do centro")
    bbox = lambda h: list(fixed) if fixed else [round(lon - h, 4), round(lat - h, 4), round(lon + h, 4), round(lat + h, 4)]
    cache = {}

    def good(g, h):
        """Recorte da data, ou None se tiver pouco dado."""
        if g["id"] not in cache:
            cache[g["id"]] = load(g)
        x = crop(*cache[g["id"]], bbox(h))
        valid = float((x.sum(2) > 0).mean())
        if valid < MIN_VALID:
            print(f"  {name}: pula {g['date']} ({valid * 100:.0f}% com dado)")
            return None
        if float(np.percentile(x, 95)) < 10:  # preview vazio (Pantanal em 05/07 vem todo com valor 1)
            print(f"  {name}: pula {g['date']} (preview vazio)")
            return None
        return x

    while half >= MIN_HALF:
        pair = None
        for i, b in enumerate(dates):
            x = good(b, half)
            if x is None:
                continue
            for a in reversed(dates[i + 1:]):
                y = good(a, half)
                if y is not None:
                    pair = (b, a, x, y)
                    break
            break
        if pair or fixed:
            break
        half = round(half - 0.05, 2)
    if not pair:
        raise RuntimeError("nenhum par de previews com dado suficiente")
    b, a, x, y = pair
    kinds = (cache[b["id"]][3], cache[a["id"]][3])
    if kinds[0] != kinds[1]:  # não acontece hoje (com token, KML que falha derruba a cena); fica de guarda
        raise RuntimeError(f"datas posicionadas de jeitos diferentes ({kinds[0]} e {kinds[1]})")
    y, alignment = align(name, cfg, cache[a["id"]], bbox(half), x, y)
    pols = [p.strip() for p in b["pol"].split("+")]
    if pols[0] != "HH" or not set(pols) <= set(CHANNEL):
        raise RuntimeError(f"polarização {b['pol']} fora do contrato (só HH e HV)")
    ok = (x.sum(2) > 0) & (y.sum(2) > 0)
    images = {f"{when}-{p}.png": img[..., CHANNEL[p]].clip(0, 255).astype(np.uint8)
              for when, img in (("before", x), ("after", y)) for p in pols}
    return {"center": [lat, lon], "bbox": bbox(half), "stack": b["stack"], "polarization": " + ".join(pols),
            "polarizations": pols,
            "before": {"date": b["date"], "granule": b["id"]}, "after": {"date": a["date"], "granule": a["id"]},
            "validPct": round(float(ok.mean()) * 100, 1),
            "georef": kinds[0], "alignment": alignment}, images


def save(name, images):
    """Troca as imagens da cena pelas novas, só depois de a cena inteira dar certo."""
    folder = os.path.join(OUT, name)
    os.makedirs(folder, exist_ok=True)
    for f in os.listdir(folder):  # imagens de uma geração anterior
        if f.endswith(".png"):
            os.remove(os.path.join(folder, f))
    for f, gray in images.items():
        Image.fromarray(gray, "L").save(os.path.join(folder, f), optimize=True)


def main():
    path = os.path.join(OUT, "manifest.json")
    manifest = json.load(open(path, encoding="utf-8")) if os.path.exists(path) else {}
    only = sys.argv[1:]
    if not token():
        print("Sem EARTHDATA_TOKEN: posição pelo contorno do quadro, que pode errar por quilômetros. "
              "Cena já posicionada pelo KML não é trocada; rode com --env-file .env.")
    failed = []
    for name, cfg in SCENES.items():
        if only and name not in only:
            continue
        if not only and manifest.get("scenes", {}).get(name, {}).get("product") == "gcov":
            print(f"{name}: imagem calibrada do GCOV (gcov_crop.py), fica como está; com o nome da cena, volta ao preview")
            continue
        try:
            m, images = run(name, cfg)
            cur = manifest.get("scenes", {}).get(name, {})
            if m["georef"] != "kml" and (cur.get("georef") == "kml" or cur.get("product") == "gcov"):
                raise RuntimeError("a versão atual foi posicionada pelo KML ou pela grade do GCOV e a nova não")
            save(name, images)
            manifest.setdefault("scenes", {})[name] = m
            print(f"{name}: {m['stack']} {m['before']['date']} -> {m['after']['date']}  bbox {m['bbox']}  {m['validPct']}% com dado")
        except Exception as e:  # a cena fica com as imagens e o manifest que já tinha (ou com o exemplo, se não tinha)
            failed.append(name)
            print(f"{name}: não gerou ({e}); fica como estava")
    manifest["generated"] = date.today().isoformat()
    manifest["source"] = ("NISAR L2 GCOV, preview _LATLON.png (8 bits, contraste esticado), catálogo CMR da NASA; "
                          "cenas com product gcov vêm do próprio arquivo GCOV (scripts/gcov_crop.py)")
    os.makedirs(OUT, exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(manifest, f, ensure_ascii=False, indent=2)
    if failed:
        sys.exit(f"sem imagem nova: {', '.join(failed)}")


if __name__ == "__main__":
    main()
