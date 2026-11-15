# Imagens calibradas das cenas: troca o preview de 8 bits pelo recorte do próprio arquivo NISAR GCOV (HDF5).
#
# Precisa do token do Earthdata no .env da raiz (EARTHDATA_TOKEN) e de internet. Lê só os blocos do recorte,
# por HTTP com leitura parcial, em vez de baixar arquivos de 1 a 7 GB: os blocos comprimidos vêm em paralelo e
# são descompactados aqui, uma faixa de linhas por vez, para a memória não crescer com o tamanho do recorte.
# Rodar da raiz do repositório, só com Docker, depois do scene_images.py da mesma cena (uma ou mais cenas):
#   docker run --rm --env-file .env -v "$PWD:/repo" -w /repo python:3.12-slim sh -c "pip install -q numpy pillow h5py fsspec aiohttp pyproj && python scripts/gcov_crop.py taquari"
# Tempo por data, medido em 14/11/2026: 40 s no Taquari (recorte de 25 km) e de 1 a 3,5 min nas cenas de 1° de lado
# (Kalimantan 1 min, Campinas 3,5 min); depende do tamanho do recorte e do modo do radar (grade de 10 ou 20 m).
#
# Usa as granules, as datas, o bbox e as polarizações que o scene_images.py gravou no manifest.json, e grava as
# mesmas imagens (before-HH.png, after-HV.png…) por cima. O manifest da cena ganha "product": "gcov" e a escala e
# perde o que só valia para o preview (georef, alignment); o scene_images.py sem nome de cena não mexe mais nela.
# Cada passagem ganha "release": a versão do produto na coleção do catálogo que guarda a granule (validated,
# provisional ou beta). A API repassa isso ao front e ao agente.
# Cena que ainda não está no manifest entra direto por aqui, sem preview, se SCENES (no scene_images.py) fixar
# stack, before, after e bbox: é o caso de Chókwè, cujas datas (coleção beta, janeiro de 2026) não têm _LATLON.png.
#
# Cada pixel de saída é a média, em potência, dos pixels do GCOV que caem nele (10 ou 20 m, conforme o modo do
# radar; gamma0 com correção de relevo, máscara de pixels válidos aplicada). A imagem grava a AMPLITUDE (raiz da
# potência) numa escala fixa, igual nas duas datas: cinza = 255 · √gamma0 / √topo, com o topo em AMPLITUDE_TOP_DB.
# Assim a razão entre dois cinzas é a razão de amplitude de verdade (1,25× ≈ 1,9 dB, 2× ≈ 6 dB) e o mapa de
# mudança do front (lib/change.ts) continua valendo sem mudar nada. Água parada, perto de −16 dB em HH, fica
# perto de cinza 40.
# A posição vem da grade do próprio arquivo (UTM); o preview posicionado pelo KML fica a menos de 1 pixel dela.
# O retângulo de amostras de cada pixel de saída é fechado por arredondamento (np.round, em crop): fica meia amostra
# do GCOV (5 ou 10 m) para o lado dos índices menores em relação ao corte pelo centro das amostras. É o mesmo desvio
# em todas as datas e cenas, no máximo um quarto do menor pixel de saída (40 m, no Taquari).
#
# O token nunca é impresso nem gravado.
import json, os, sys, time, urllib.parse, urllib.request, zlib
import numpy as np
from PIL import Image

OUT = "apps/api/scene-images"
SIZE = 640
COLLECTIONS = ["C3622241360-ASF", "C2854338529-ASF", "C3622214170-ASF"]  # validada, provisória, beta
RELEASES = ["validated", "provisional", "beta"]  # a versão do produto em cada coleção, na mesma ordem
# Topo da escala de cada polarização, em dB de gamma0: acima disso o pixel fica branco. HV é uns 6 dB mais fraco.
AMPLITUDE_TOP_DB = {"HH": 0.0, "HV": -6.0}
GRID = "science/LSAR/GCOV/grids/frequencyA"
BAND = 4        # linhas de blocos do arquivo lidas por vez: limita a memória a algumas centenas de MB
PARALLEL = 16   # pedidos HTTP ao mesmo tempo


def h5_source(granule):
    """Endereço HTTPS do arquivo .h5 da granule e a versão (release) da coleção que o guarda, pelo catálogo público
    da NASA (CMR): validated, provisional ou beta."""
    for c, release in zip(COLLECTIONS, RELEASES):
        q = urllib.parse.urlencode({"collection_concept_id": c, "readable_granule_name": granule})
        with urllib.request.urlopen("https://cmr.earthdata.nasa.gov/search/granules.umm_json?" + q, timeout=60) as r:
            items = json.load(r)["items"]
        for it in items:
            for u in it["umm"].get("RelatedUrls", []):
                if u["URL"].startswith("https") and u["URL"].endswith(".h5"):
                    return u["URL"], release
    raise RuntimeError(f"{granule} sem arquivo .h5 no CMR")


def h5_url(granule):
    """Só o endereço HTTPS do arquivo .h5 da granule."""
    return h5_source(granule)[0]


def find_granule(name, lat, lon, stack, day):
    """A granule GCOV de uma órbita (`stack`) sobre um ponto num dia, no catálogo público da NASA (CMR), e as
    polarizações dela. A coleção mais confiável primeiro."""
    for c in COLLECTIONS:
        q = urllib.parse.urlencode({"collection_concept_id": c, "point": f"{lon},{lat}", "page_size": 50,
                                    "temporal": f"{day}T00:00:00Z,{day}T23:59:59Z"})
        with urllib.request.urlopen("https://cmr.earthdata.nasa.gov/search/granules.umm_json?" + q, timeout=60) as r:
            items = json.load(r)["items"]
        for it in items:
            aa = {a["Name"]: a["Values"][0] for a in it["umm"].get("AdditionalAttributes", [])}
            if aa.get("STACK_ID") == stack:
                return it["umm"]["GranuleUR"], [p.strip() for p in aa.get("FREQUENCY_A_POLARIZATION_CONCAT", "").split("+")]
    sys.exit(f"{name}: nenhuma granule de {stack} em {day} no catálogo")


def earlier_passes(name, m):
    """Passagens anteriores à `before` pedidas em SCENES (chave `earlier`, datas da mesma órbita): a série da cena
    fica com mais de duas datas, todas na mesma escala. Cada uma vira earlier-<data>-<POL>.png e uma entrada em
    `earlier` no manifest, que a API põe antes das duas passagens de sempre."""
    from scene_images import SCENES
    out = []
    for day in sorted(set(SCENES.get(name, {}).get("earlier", []))):
        if day >= m["before"]["date"]:
            sys.exit(f"{name}: {day} em `earlier` não é anterior à passagem de antes ({m['before']['date']})")
        granule, pols = find_granule(name, m["center"][0], m["center"][1], m["stack"], day)
        if not set(m["polarizations"]) <= set(pols):
            sys.exit(f"{name}: a passagem de {day} tem {pols}, sem todas as polarizações da cena ({m['polarizations']})")
        out.append({"date": day, "granule": granule})
    return out


def catalog_entry(name):
    """Entrada do manifest de uma cena que ainda não está lá, sem passar pelo preview: centro, órbita, datas e
    recorte vêm de SCENES (scene_images.py); as granules das duas datas, do catálogo público da NASA (CMR)."""
    from scene_images import SCENES
    cfg = SCENES.get(name)
    if not cfg or not all(k in cfg for k in ("stack", "before", "after", "bbox")):
        sys.exit(f"{name} fora do manifest: rode antes o scene_images.py da cena, ou fixe stack, before, after e bbox em SCENES")
    found = {when: find_granule(name, cfg["lat"], cfg["lon"], cfg["stack"], cfg[when]) for when in ("before", "after")}
    pols = found["before"][1]
    if pols != found["after"][1] or pols[0] != "HH" or not set(pols) <= set(AMPLITUDE_TOP_DB):
        sys.exit(f"{name}: polarizações {found['before'][1]} e {found['after'][1]} fora do contrato (HH ou HH + HV, iguais nas duas datas)")
    return {"center": [cfg["lat"], cfg["lon"]], "bbox": list(cfg["bbox"]), "stack": cfg["stack"],
            "polarization": " + ".join(pols), "polarizations": pols,
            "before": {"date": cfg["before"], "granule": found["before"][0]},
            "after": {"date": cfg["after"], "granule": found["after"][0]}}


def open_h5(url):
    """O arquivo aberto por HTTP (para os metadados) e o sistema de arquivos que busca pedaços dele."""
    import fsspec, h5py
    token = os.environ.get("EARTHDATA_TOKEN", "").strip().strip('"').strip("'")  # --env-file não tira aspas
    if not token:
        raise RuntimeError("EARTHDATA_TOKEN vazio: defina no .env da raiz e rode com --env-file .env")
    fs = fsspec.filesystem("https", client_kwargs={"headers": {"Authorization": "Bearer " + token}})
    return h5py.File(fs.open(url, block_size=2**20, cache_type="blockcache"), "r"), fs


def fetch_ranges(fs, url, spans):
    """Os bytes de cada (início, tamanho) do arquivo, PARALLEL pedidos por vez; o que falhar é pedido de novo."""
    out, todo = [None] * len(spans), list(range(len(spans)))
    for attempt in range(4):
        got = fs.cat_ranges([url] * len(todo), [spans[i][0] for i in todo], [sum(spans[i]) for i in todo],
                            batch_size=PARALLEL, on_error="return")
        failed = []
        for i, b in zip(todo, got):
            if isinstance(b, (bytes, bytearray)) and len(b) == spans[i][1]:
                out[i] = b
            else:
                failed.append(i)  # o erro não é impresso: pode trazer o cabeçalho com o token
        if not failed:
            return out
        todo = failed
        time.sleep(3 * (attempt + 1))
    raise RuntimeError(f"{len(todo)} blocos não vieram do servidor")


def read_rows(dset, fs, url, ra, rb, c0, c1, check=False):
    """dset[ra:rb, c0:c1]. Busca os blocos comprimidos em paralelo e descompacta aqui (gzip, com ou sem shuffle)."""
    plist = dset.id.get_create_plist()
    filters = [plist.get_filter(i)[0] for i in range(plist.get_nfilters())]  # 1: gzip, 2: shuffle
    if dset.chunks is None or filters not in ([2, 1], [1]):
        return dset[ra:rb, c0:c1]  # compressão que não conhecemos: leitura comum, mais lenta
    ch_r, ch_c = dset.chunks
    cells, spans = [], []
    for cr in range(ra // ch_r, (rb - 1) // ch_r + 1):
        for cc in range(c0 // ch_c, (c1 - 1) // ch_c + 1):
            info = dset.id.get_chunk_info_by_coord((cr * ch_r, cc * ch_c))
            if info.byte_offset is None or not info.size:
                continue  # bloco nunca gravado: fica o valor de preenchimento
            if info.filter_mask:
                return dset[ra:rb, c0:c1]
            cells.append((cr, cc))
            spans.append((info.byte_offset, info.size))
    out = np.full((rb - ra, c1 - c0), dset.fillvalue, dset.dtype)
    n = dset.dtype.itemsize
    for (cr, cc), raw in zip(cells, fetch_ranges(fs, url, spans)):
        b = np.frombuffer(zlib.decompress(raw), np.uint8)
        if filters[0] == 2 and n > 1:  # shuffle: os bytes de mesma posição de cada número vêm juntos
            b = np.ascontiguousarray(b.reshape(n, -1).T)
        block = b.view(dset.dtype).reshape(ch_r, ch_c)
        y, x = cr * ch_r, cc * ch_c
        ys, ye, xs, xe = max(y, ra), min(y + ch_r, rb), max(x, c0), min(x + ch_c, c1)
        out[ys - ra:ye - ra, xs - c0:xe - c0] = block[ys - y:ye - y, xs - x:xe - x]
    # confere um canto com a leitura comum do h5py: se a descompactação daqui divergir, para em vez de gravar errado
    # (canto que cai num bloco nunca gravado compara preenchimento com preenchimento e não confere nada)
    kr, kc = min(16, rb - ra), min(16, c1 - c0)
    if check and not np.array_equal(out[:kr, :kc], dset[ra:ra + kr, c0:c0 + kc], equal_nan=True):
        raise RuntimeError(f"{dset.name}: os blocos lidos em paralelo não batem com a leitura do h5py")
    return out


def crop(f, fs, url, bbox, pols):
    """gamma0 linear médio de cada polarização numa grade lat/lon de SIZE × SIZE sobre o bbox; NaN sem dado."""
    from pyproj import Transformer
    grid = f[GRID]
    tr = Transformer.from_crs(4326, int(grid["projection"][()]), always_xy=True)
    x, y = grid["xCoordinates"][()], grid["yCoordinates"][()]
    dx, dy = x[1] - x[0], y[1] - y[0]
    w, s, e, n = bbox
    lons = w + (np.arange(SIZE) + 0.5) / SIZE * (e - w)
    lats = n - (np.arange(SIZE) + 0.5) / SIZE * (n - s)
    LON, LAT = np.meshgrid(lons, lats)
    # meia largura do pixel de saída em pixels do GCOV, pelos vizinhos projetados (vale para qualquer UTM)
    X, Y = tr.transform(LON, LAT)
    Xe, _ = tr.transform(LON + (e - w) / SIZE / 2, LAT)
    _, Yn = tr.transform(LON, LAT + (n - s) / SIZE / 2)
    hx, hy = np.abs(Xe - X) / abs(dx), np.abs(Yn - Y) / abs(dy)
    cx, cy = (X - x[0]) / dx, (Y - y[0]) / dy
    c0, c1 = int(np.floor((cx - hx).min())) - 2, int(np.ceil((cx + hx).max())) + 2
    r0, r1 = int(np.floor((cy - hy).min())) - 2, int(np.ceil((cy + hy).max())) + 2
    if c0 < 0 or r0 < 0 or c1 > len(x) or r1 > len(y):
        raise RuntimeError("o bbox sai da grade do arquivo")
    # retângulo de pixels do GCOV de cada pixel de saída, em linhas e colunas contadas a partir de (r0, c0)
    i0 = np.clip(np.round(cy - hy - r0).astype(int), 0, r1 - r0); i1 = np.clip(np.round(cy + hy - r0).astype(int), 0, r1 - r0)
    j0 = np.clip(np.round(cx - hx - c0).astype(int), 0, c1 - c0); j1 = np.clip(np.round(cx + hx - c0).astype(int), 0, c1 - c0)
    total = {p: np.zeros((SIZE, SIZE)) for p in pols}
    count = {p: np.zeros((SIZE, SIZE)) for p in pols}
    step = BAND * (grid["mask"].chunks or (512, 512))[0]
    for top in range(r0 // step * step, r1, step):
        ra, rb = max(top, r0), min(top + step, r1)
        first = top <= r0  # a conferência com o h5py roda uma vez por camada
        mask = read_rows(grid["mask"], fs, url, ra, rb, c0, c1, first)
        valid_mask = (mask > 0) & (mask < 255)  # 0: amostra parcial ou inválida; 255: fora da aquisição
        # a parte de cada retângulo que cai nesta faixa de linhas
        a0, a1 = np.clip(i0 - (ra - r0), 0, rb - ra), np.clip(i1 - (ra - r0), 0, rb - ra)
        box = lambda T: T[a1, j1] - T[a0, j1] - T[a1, j0] + T[a0, j0]
        for p in pols:
            a = read_rows(grid[p + p], fs, url, ra, rb, c0, c1, first).astype(np.float64)
            ok = valid_mask & np.isfinite(a) & (a > 0)
            a[~ok] = 0
            # soma acumulada 2D: soma de cada retângulo em tempo constante
            total[p] += box(np.pad(a.cumsum(0).cumsum(1), ((1, 0), (1, 0))))
            count[p] += box(np.pad(ok.astype(np.float64).cumsum(0).cumsum(1), ((1, 0), (1, 0))))
    return {p: np.where(count[p] > 0, total[p] / np.maximum(count[p], 1), np.nan) for p in pols}


def to_gray(g0, pol):
    top = 10 ** (AMPLITUDE_TOP_DB[pol] / 20)
    amp = np.sqrt(np.nan_to_num(g0, nan=0.0))
    return (np.clip(amp / top, 0, 1) * 255).round().astype(np.uint8)


def run(name, m):
    folder = os.path.join(OUT, name)
    pols = m["polarizations"]
    data, release = {}, {}
    earlier = earlier_passes(name, m)
    # chave → passagem: as anteriores, da mais antiga para a mais recente, e depois as duas de sempre
    passes = {f"earlier-{p['date']}": p for p in earlier} | {when: m[when] for when in ("before", "after")}
    for when, entry in passes.items():
        t = time.time()
        url, release[when] = h5_source(entry["granule"])
        f, fs = open_h5(url)
        listed = [p.decode() if isinstance(p, bytes) else str(p) for p in f[GRID]["listOfPolarizations"][()]]
        if not set(pols) <= set(listed):
            raise RuntimeError(f"{entry['granule']} não tem {pols} (tem {listed})")
        data[when] = crop(f, fs, url, m["bbox"], pols)
        f.close()
        print(f"  {name} {entry['date']}: {time.time() - t:.0f} s")
    valid = np.ones((SIZE, SIZE), bool)
    for when in data:
        for p in pols:
            valid &= np.isfinite(data[when][p])
    os.makedirs(folder, exist_ok=True)
    for when in data:
        for p in pols:
            Image.fromarray(to_gray(data[when][p], p), "L").save(os.path.join(folder, f"{when}-{p}.png"), optimize=True)
        for p in pols:
            v = data[when][p][valid]
            print(f"  {name} {when} {p}: mediana {10 * np.log10(np.median(v)):.1f} dB")
    m = dict(m)
    for k in ("georef", "alignment"):  # valiam para o preview; aqui a posição vem da grade do arquivo
        m.pop(k, None)
    for when in ("before", "after"):  # a versão de cada passagem: uma cena pode comparar uma provisória com uma validada
        m[when] = {**m[when], "release": release[when]}
    m.pop("earlier", None)
    if earlier:
        m["earlier"] = [{**p, "release": release[f"earlier-{p['date']}"]} for p in earlier]
    m["product"] = "gcov"
    m["scale"] = {"quantity": "gamma0 amplitude", "topDb": {p: AMPLITUDE_TOP_DB[p] for p in pols}}
    m["validPct"] = round(float(valid.mean()) * 100, 1)
    return m


def main():
    path = os.path.join(OUT, "manifest.json")
    manifest = json.load(open(path, encoding="utf-8"))
    names = sys.argv[1:]
    if not names:
        sys.exit("diga a cena: python scripts/gcov_crop.py taquari")
    manifest["source"] = ("NISAR L2 GCOV, preview _LATLON.png (8 bits, contraste esticado), catálogo CMR da NASA; "
                          "cenas com product gcov vêm do próprio arquivo GCOV (scripts/gcov_crop.py)")
    for name in names:
        m = manifest.get("scenes", {}).get(name) or catalog_entry(name)
        manifest.setdefault("scenes", {})[name] = run(name, m)
        # grava a cada cena: se a próxima falhar, as imagens já trocadas continuam batendo com o manifest
        with open(path, "w", encoding="utf-8") as f:
            json.dump(manifest, f, ensure_ascii=False, indent=2)
        print(f"{name}: GCOV {m['before']['date']} -> {m['after']['date']}, {manifest['scenes'][name]['validPct']}% com dado")


if __name__ == "__main__":
    main()
