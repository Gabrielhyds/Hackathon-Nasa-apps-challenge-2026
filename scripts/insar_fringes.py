# Interferogramas reais do NISAR sobre o terremoto da Venezuela (24/06/2026), para a régua de franjas do front.
#
# Tudo público, sem login. Rodar da raiz do repositório, só com Docker (baixa cerca de 3 MB por interferograma):
#   docker run --rm -v "$PWD:/repo" -w /repo python:3.12-slim sh -c "pip install -q numpy pillow matplotlib && python scripts/insar_fringes.py"
#
# Grava em apps/web/src/assets/insar: <id>.png (a fase, um byte por pixel) e insar.json (datas, posição, epicentros
# e a tabela de cores).
#
# O preview _LATLON.png do produto GUNW pinta a fase enrolada com a tabela cíclica "twilight" do matplotlib, sem
# mistura: cada cor volta a um índice de 0 a 255 e a fase é índice/256 de uma volta. Uma volta de fase é meio
# comprimento de onda de mudança na distância até o satélite (ida e volta): cerca de 12 cm na banda L (CYCLE_CM).
# Nada é descontado do preview: ionosfera e troposfera estão dentro da fase. Por isso a tela só conta voltas e diz
# quanto vale uma; não soma centímetros nem diz quanto ou para que lado o chão andou.
# O script desfaz a tabela de cores, faz a média complexa de 2 × 2 pixels (menos ruído, pixel de uns 480 m) e
# grava a fase em PNG de tons de cinza: 0 = sem dado, 1 a 255 = fase. O navegador pinta de novo com a mesma tabela.
#
# Dois interferogramas do mesmo quadro (trilha 162, ascendente), com 12 dias cada:
#   before  01/06 → 13/06   sem terremoto: as franjas largas são atmosfera e ionosfera
#   quake   13/06 → 25/06   atravessa os dois tremores de 24/06 (M 7,2 e M 7,5, USGS)
import io, json, os, urllib.parse, urllib.request
import numpy as np
from PIL import Image
from matplotlib import colormaps

OUT = "apps/web/src/assets/insar"
COLLECTIONS = ["C3622247503-ASF", "C2854335566-ASF", "C2850261892-ASF"]  # GUNW validado, provisório, beta
POINT = (-67.9, 10.45)   # entre os dois epicentros
STACK = "162_A_007"
PAIRS = {"before": ("2026-06-01", "2026-06-13"), "quake": ("2026-06-13", "2026-06-25")}
# Recorte, em pixels depois da média de 2 × 2: tira a moldura vazia e o mar aberto ao norte
CROP = (30, 130, 690, 650)  # esquerda, cima, direita, baixo
EVENTS = [  # USGS, 24/06/2026 (us6000t7zc e us6000t7zp)
    {"mag": 7.2, "time": "2026-06-24T22:04:31Z", "lat": 10.3713, "lon": -68.5564},
    {"mag": 7.5, "time": "2026-06-24T22:05:04Z", "lat": 10.5955, "lon": -67.2205},
]
# Centímetros de mudança na distância até o satélite por volta de fase: 100 · c / (2 · frequência central).
# O preview não traz a frequência; o valor é o que scripts/gunw_crop.py leu do arquivo GUNW da cena laguaira,
# do mesmo modo de aquisição (4000_SH no nome da granule). É o mesmo cycleCm que a API manda nessa cena.
CYCLE_CM = 12.1


def find(first, second):
    for c in COLLECTIONS:
        q = urllib.parse.urlencode({"collection_concept_id": c, "point": f"{POINT[0]},{POINT[1]}", "page_size": 200,
                                    "temporal": f"{first}T00:00:00Z,{second}T23:59:59Z"})
        with urllib.request.urlopen("https://cmr.earthdata.nasa.gov/search/granules.umm_json?" + q, timeout=60) as r:
            items = json.load(r)["items"]
        for it in items:
            u = it["umm"]
            name = u["GranuleUR"]
            if f"_{STACK}_" not in name or first.replace("-", "") + "T" not in name or second.replace("-", "") + "T" not in name:
                continue
            browse = [x["URL"] for x in u.get("RelatedUrls", []) if x["URL"].startswith("https") and x["URL"].endswith("_LATLON.png")]
            pts = u["SpatialExtent"]["HorizontalSpatialDomain"]["Geometry"]["GPolygons"][0]["Boundary"]["Points"]
            if browse:
                return {"id": name, "browse": browse[0], "poly": [(p["Longitude"], p["Latitude"]) for p in pts]}
    raise RuntimeError(f"sem interferograma {STACK} de {first} a {second} no CMR")


def main():
    lut = (colormaps["twilight"](np.linspace(0, 1, 256, endpoint=False))[:, :3] * 255).round().astype(np.int32)
    os.makedirs(OUT, exist_ok=True)
    meta = {"cycleCm": CYCLE_CM, "track": 162, "direction": "ascending", "events": EVENTS, "pairs": {},
            "lut": ["%02x%02x%02x" % tuple(c) for c in lut]}
    for key, (first, second) in PAIRS.items():
        g = find(first, second)
        with urllib.request.urlopen(g["browse"], timeout=180) as r:
            a = np.asarray(Image.open(io.BytesIO(r.read())).convert("RGBA")).astype(np.int32)
        valid = a[..., 3] > 0
        rgb = a[..., :3].reshape(-1, 3)
        idx = np.zeros(len(rgb), np.uint8)
        worst = 0.0
        for i in range(0, len(rgb), 200_000):  # cor → índice na tabela
            d = ((rgb[i:i + 200_000, None, :] - lut[None]) ** 2).sum(2)
            idx[i:i + 200_000] = d.argmin(1)
            worst = max(worst, float(np.sqrt(d.min(1))[valid.reshape(-1)[i:i + 200_000]].mean()))
        if worst > 3:
            raise RuntimeError(f"o preview de {key} não usa a tabela twilight (erro médio {worst:.1f})")
        idx = idx.reshape(valid.shape)
        # posição: o preview é norte para cima e ocupa o retângulo envolvente do contorno do quadro
        ys, xs = np.where(valid.any(1))[0], np.where(valid.any(0))[0]
        lons, lats = [p[0] for p in g["poly"]], [p[1] for p in g["poly"]]
        lon_at = lambda x: min(lons) + (x - xs[0]) / (xs[-1] - xs[0]) * (max(lons) - min(lons))
        lat_at = lambda y: max(lats) - (y - ys[0]) / (ys[-1] - ys[0]) * (max(lats) - min(lats))
        # média complexa de 2 × 2
        z = np.exp(2j * np.pi * idx / 256) * valid
        h, w = idx.shape[0] // 2 * 2, idx.shape[1] // 2 * 2
        m = z[:h, :w].reshape(h // 2, 2, w // 2, 2).mean((1, 3))
        ok = valid[:h, :w].reshape(h // 2, 2, w // 2, 2).all((1, 3))
        phase = (np.angle(m) / (2 * np.pi)) % 1
        out = np.where(ok, 1 + np.minimum(254, (phase * 255).astype(int)), 0).astype(np.uint8)
        l, t, r_, b = CROP
        out = out[t:b, l:r_]
        Image.fromarray(out, "L").save(os.path.join(OUT, f"{key}.png"), optimize=True)
        west, east, north, south = lon_at(2 * l), lon_at(2 * r_), lat_at(2 * t), lat_at(2 * b)
        km_px = (north - south) * 110.57 / out.shape[0]
        meta["pairs"][key] = {"first": first, "second": second, "granule": g["id"], "width": out.shape[1], "height": out.shape[0],
                              "bbox": [round(west, 4), round(south, 4), round(east, 4), round(north, 4)], "kmPerPixel": round(km_px, 3)}
        print(f"{key}: {first} -> {second}  {out.shape[1]}x{out.shape[0]}  {km_px:.2f} km/pixel  {os.path.getsize(os.path.join(OUT, key + '.png')) // 1024} kB")
    with open(os.path.join(OUT, "insar.json"), "w", encoding="utf-8") as f:
        json.dump(meta, f, ensure_ascii=False, separators=(",", ":"))
        f.write("\n")


if __name__ == "__main__":
    main()
