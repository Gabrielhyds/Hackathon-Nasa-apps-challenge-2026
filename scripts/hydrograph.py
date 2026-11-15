# Contexto da cheia do Taquari: o que existe de público, fora do NISAR, para conferir a série de água da cena
# (chuva, vazão modelada, dias de visão óptica e o mapa de água do OPERA), mais a miniatura de cada passagem.
#
# A medida de água NÃO sai daqui: é a água aberta nova de scripts/water_series.py, no dado calibrado
# (campo `waterSeries` da cena). Este script já mediu a água no preview de 8 bits; esses números saíram.
#
# Tudo público, sem login. Rodar da raiz do repositório, só com Docker (baixa cerca de 5 MB por passagem):
#   docker run --rm -v "$PWD:/repo" -w /repo python:3.12-slim sh -c "pip install -q numpy pillow && python scripts/hydrograph.py"
#
# Grava:
#   packages/contract/src/fixtures/taquari-context.json      o contexto (vai no campo `floodContext` da cena)
#   apps/web/src/assets/hydro/<data>.jpg                     o recorte HH de cada passagem, do preview: só para ver
#   apps/web/src/assets/hydro/opera-<data>.png, hls-<data>.jpg   mapas independentes para conferir a enchente
#
# De onde vem cada coisa:
# - Miniaturas: preview _LATLON.png de cada passagem GCOV sobre o centro da cena (catálogo CMR), recortado no bbox
#   da cena. O preview tem pixel de uns 170 m e contraste esticado em cada data: serve para ver, não para medir.
# - OPERA DSWx-S1 (GIBS): mapa de água feito pelo JPL com o Sentinel-1 (banda C), outro satélite e outro método.
#   É toda a água aberta do recorte, com o leito do rio: não é a mesma medida da série (só a água nova).
# - OPERA DSWx-HLS (GIBS): mapa óptico; daqui sai a fração do recorte coberta por nuvem em cada dia.
# - Chuva: reanálise ERA5 pelo Open-Meteo, média de cinco pontos da bacia. Vazão: modelo GloFAS pelo Open-Meteo.
# - Nível do rio: não é daqui; as leituras, com fonte, ficam na fixture da cena (`riverGauge`).
import io, json, math, os, sys, urllib.parse, urllib.request
from concurrent.futures import ThreadPoolExecutor
from datetime import date, timedelta
import numpy as np
from PIL import Image

sys.path.insert(0, os.path.dirname(__file__))
from scene_images import SCENES, granules, load, crop  # noqa: E402

SCENE = "taquari"
OUT_JSON = "packages/contract/src/fixtures/taquari-context.json"
OUT_IMG = "apps/web/src/assets/hydro"
SINCE = "2026-06-10"
THUMB = 300          # lado da miniatura, em pixels (o recorte nativo do preview tem uns 150)
GIBS = "https://gibs.earthdata.nasa.gov/wms/epsg4326/best/wms.cgi?"
BASIN = [(-29.47, -51.96), (-29.0, -51.9), (-28.9, -51.5), (-28.7, -51.0), (-28.5, -51.6)]
RIVER = (-29.47, -51.96)  # Lajeado
# Mapas que vão para a tela, ao lado da passagem da enchente
SHOW = {"opera": ["2026-07-13", "2026-07-25"], "hls": ["2026-07-25"]}


def bbox_km2(b):
    w, s, e, n = b
    return (e - w) * 111.32 * math.cos(math.radians((s + n) / 2)) * (n - s) * 110.57


def wms(layer, day, bbox, size):
    w, s, e, n = bbox
    q = urllib.parse.urlencode({"SERVICE": "WMS", "REQUEST": "GetMap", "VERSION": "1.3.0", "LAYERS": layer, "CRS": "EPSG:4326",
                                "BBOX": f"{s},{w},{n},{e}", "WIDTH": size, "HEIGHT": size, "FORMAT": "image/png", "TIME": day, "TRANSPARENT": "TRUE"})
    for attempt in range(3):
        try:
            with urllib.request.urlopen(GIBS + q, timeout=90) as r:
                return Image.open(io.BytesIO(r.read())).convert("RGBA")
        except Exception:
            if attempt == 2:
                return None


def days(start, end):
    d = date.fromisoformat(start)
    while d <= date.fromisoformat(end):
        yield d.isoformat()
        d += timedelta(1)


def fetch_json(url):
    with urllib.request.urlopen(url, timeout=60) as r:
        return json.load(r)


def main():
    cfg = SCENES[SCENE]
    bbox, area = cfg["bbox"], bbox_km2(cfg["bbox"])
    os.makedirs(OUT_IMG, exist_ok=True)
    for f in os.listdir(OUT_IMG):
        os.remove(os.path.join(OUT_IMG, f))

    # ---- radar: a miniatura de cada passagem ----
    gs = sorted((g for g in granules(cfg["lat"], cfg["lon"]) if g["date"] >= SINCE and g["pol"].startswith("HH")), key=lambda g: g["date"])
    passes = []
    for g in gs:
        x = crop(*load(g), bbox)
        hh = x[..., 0]
        if float((x.sum(2) > 0).mean()) < 0.98:
            print(f"  pula {g['date']} {g['stack']}: recorte incompleto")
            continue
        passes.append(g["date"])
        Image.fromarray(hh.clip(0, 255).astype(np.uint8), "L").resize((THUMB, THUMB), Image.BICUBIC).save(
            os.path.join(OUT_IMG, f"{g['date']}.jpg"), quality=72, optimize=True)
        print(f"  {g['date']} {g['stack']}")
    last = passes[-1]
    end = (date.fromisoformat(last) + timedelta(5)).isoformat()

    # ---- OPERA: água pelo Sentinel-1 e nuvem pelo óptico, dia a dia ----
    all_days = list(days(SINCE, end))
    with ThreadPoolExecutor(8) as ex:
        s1 = list(ex.map(lambda d: wms("OPERA_L3_Dynamic_Surface_Water_Extent-Sentinel-1", d, bbox, 512), all_days))
        hls = list(ex.map(lambda d: wms("OPERA_L3_Dynamic_Surface_Water_Extent-HLS", d, bbox, 256), all_days))
    independent, optical = [], []
    for d, im in zip(all_days, s1):
        if im is None:
            continue
        a = np.asarray(im)
        if (a[..., 3] > 0).mean() < 0.98:
            continue
        water = (a[..., 0] == 0) & (a[..., 1] == 0) & (a[..., 2] == 255)  # azul: água aberta
        independent.append({"date": d, "waterKm2": round(float(water.mean()) * area, 1)})
    for d, im in zip(all_days, hls):
        if im is None:
            continue
        a = np.asarray(im)
        seen = a[..., 3] > 0
        if seen.mean() < 0.9:
            continue  # o satélite óptico não cobriu o recorte nesse dia
        cloud = (a[..., 0] == 175) & (a[..., 1] == 175) & (a[..., 2] == 175)  # cinza: nuvem ou sombra de nuvem
        optical.append({"date": d, "cloudPct": int(round(float(cloud[seen].mean()) * 100))})

    # ---- mapas para a tela ----
    for d in SHOW["opera"]:
        im = wms("OPERA_L3_Dynamic_Surface_Water_Extent-Sentinel-1", d, bbox, THUMB)
        a = np.asarray(im)
        out = np.full(a.shape[:2] + (3,), (13, 18, 28), np.uint8)  # terra: o escuro da interface
        out[(a[..., 2] == 255) & (a[..., 0] == 0) & (a[..., 1] == 0)] = (92, 225, 255)   # água aberta
        out[(a[..., 1] == 255) & (a[..., 0] == 0) & (a[..., 2] == 0)] = (46, 112, 128)   # vegetação alagada
        Image.fromarray(out).quantize(8).save(os.path.join(OUT_IMG, f"opera-{d}.png"), optimize=True)
    for d in SHOW["hls"]:
        im = wms("HLS_S30_Nadir_BRDF_Adjusted_Reflectance", d, bbox, THUMB)
        bg = Image.new("RGBA", im.size, (13, 18, 28, 255))
        bg.alpha_composite(im)
        bg.convert("RGB").save(os.path.join(OUT_IMG, f"hls-{d}.jpg"), quality=78, optimize=True)

    # ---- chuva (ERA5) e vazão modelada (GloFAS) ----
    rain = np.array([[v if v is not None else np.nan for v in fetch_json(
        f"https://archive-api.open-meteo.com/v1/archive?latitude={la}&longitude={lo}&start_date={SINCE}&end_date={end}"
        "&daily=precipitation_sum&timezone=America%2FSao_Paulo")["daily"]["precipitation_sum"]] for la, lo in BASIN])
    rain = [None if np.isnan(v) else round(float(v), 1) for v in np.nanmean(rain, 0)]
    q = fetch_json(f"https://flood-api.open-meteo.com/v1/flood?latitude={RIVER[0]}&longitude={RIVER[1]}&start_date={SINCE}&end_date={end}&daily=river_discharge")
    discharge = [None if v is None else round(v) for v in q["daily"]["river_discharge"]]

    out = {
        "generated": date.today().isoformat(), "start": SINCE, "end": end,
        "rainMm": rain, "dischargeM3s": discharge, "optical": optical, "independent": independent,
        "maps": {"opera": SHOW["opera"], "hls": SHOW["hls"]},
    }
    with open(OUT_JSON, "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, separators=(",", ":"))
    print(f"{len(passes)} miniaturas, {len(independent)} mapas OPERA, {len(optical)} dias ópticos -> {OUT_JSON}")


if __name__ == "__main__":
    main()
