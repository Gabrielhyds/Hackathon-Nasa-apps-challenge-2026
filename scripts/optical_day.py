# O que um satélite óptico viu num dia do evento de uma cena: a cor verdadeira do MODIS, para pôr em volta do radar.
# No Taquari, 23/07/2026, o dia da passagem do NISAR que a cena mostra: o vale debaixo de nuvem, horas antes do radar.
#
# Tudo público, sem login. Rodar da raiz do repositório:
#   docker run --rm -v "$PWD:/repo" -w /repo python:3.12-slim sh -c "pip install -q pillow && python scripts/optical_day.py"
#
# Grava apps/web/src/assets/optical/<cena>-<data>.webp. A imagem entra no pacote da página: funciona sem API e sem
# internet (e precisa ficar abaixo de 400 kB, para caber no preview). A data, o recorte e a legenda ficam na fixture
# da cena (campo `opticalDay`, em packages/contract/src/fixtures/scenes.ts); OPTICAL, abaixo, repete a data e o
# recorte, e um teste do front confere que toda cena com `opticalDay` tem a imagem.
#
# De onde vem: NASA GIBS (WMS), camada MODIS_Aqua_CorrectedReflectance_TrueColor, a imagem diária do satélite Aqua,
# 250 m por pixel. O pedido é feito em EPSG:3857 (Mercator), que é como o mapa
# estica uma imagem entre quatro cantos: assim ela cai no lugar certo sem reprojeção. A borda sai transparente aos
# poucos (FEATHER), para a imagem não terminar num corte reto sobre o mapa.
#
# Por que 23/07 e não 22/07, o dia do pico do rio: em 22/07 a região inteira é um branco liso, sem textura nem
# costa, e na tela não se lê como nuvem; em 23/07 a nuvem tem relevo, e é o mesmo dia da imagem de radar.
# Limites: é uma imagem por dia, de uma passagem só, de dia; a do radar é do fim da tarde (21h33 UTC). Branco é
# nuvem, mas esta imagem não mede quanto do vale estava coberto: é para ver.
import io, math, os, sys, urllib.parse, urllib.request
from PIL import Image, ImageChops, ImageDraw, ImageFilter

OUT = "apps/web/src/assets/optical"
GIBS = "https://gibs.earthdata.nasa.gov/wms/epsg3857/best/wms.cgi?"
LAYER = "MODIS_Aqua_CorrectedReflectance_TrueColor"
WIDTH = 1920
FEATHER = 90  # largura, em pixels, da borda que esmaece
LIMIT = 400_000
# cena → dia e recorte [oeste, sul, leste, norte]; os mesmos valores do campo `opticalDay` da fixture
OPTICAL = {
    "taquari": {"date": "2026-07-23", "bbox": [-54.3, -31.6, -49.3, -27.9]},
}


def mercator(lon, lat):
    r = 6378137.0
    return r * math.radians(lon), r * math.log(math.tan(math.pi / 4 + math.radians(lat) / 2))


def main():
    names = sys.argv[1:] or list(OPTICAL)
    os.makedirs(OUT, exist_ok=True)
    for name in names:
        cfg = OPTICAL.get(name)
        if not cfg:
            sys.exit(f"{name} não está em OPTICAL")
        w, s, e, n = cfg["bbox"]
        (x0, y0), (x1, y1) = mercator(w, s), mercator(e, n)
        height = round(WIDTH * (y1 - y0) / (x1 - x0))
        q = urllib.parse.urlencode({"SERVICE": "WMS", "REQUEST": "GetMap", "VERSION": "1.3.0", "LAYERS": LAYER, "CRS": "EPSG:3857",
                                    "BBOX": f"{x0},{y0},{x1},{y1}", "WIDTH": WIDTH, "HEIGHT": height, "FORMAT": "image/jpeg", "TIME": cfg["date"]})
        with urllib.request.urlopen(GIBS + q, timeout=120) as r:
            kind, data = r.headers.get("content-type", ""), r.read()
        if not kind.startswith("image/jpeg") or len(data) < 5000:
            sys.exit(f"{name}: o GIBS não devolveu imagem ({kind}, {len(data)} bytes)")
        image = Image.open(io.BytesIO(data)).convert("RGB")
        # faixa sem dado vem preta: fica transparente, como a borda
        alpha = Image.new("L", image.size, 0)
        ImageDraw.Draw(alpha).rectangle([FEATHER, FEATHER, WIDTH - FEATHER, height - FEATHER], fill=255)
        alpha = alpha.filter(ImageFilter.GaussianBlur(FEATHER / 2.5))
        empty = image.convert("L").point(lambda v: 0 if v < 4 else 255).filter(ImageFilter.MinFilter(9)).filter(ImageFilter.GaussianBlur(12))
        image.putalpha(ImageChops.multiply(alpha, empty))
        path = os.path.join(OUT, f"{name}-{cfg['date']}.webp")
        for quality in (82, 76, 70, 64, 58):
            image.save(path, "WEBP", quality=quality, method=6)
            if os.path.getsize(path) < LIMIT:
                break
        else:
            sys.exit(f"{name}: a imagem passa de {LIMIT // 1000} kB mesmo com qualidade 58; diminua o recorte")
        print(f"{name}: {cfg['date']}, {WIDTH} × {height} px, qualidade {quality}, {os.path.getsize(path) // 1000} kB -> {path}")


if __name__ == "__main__":
    main()
