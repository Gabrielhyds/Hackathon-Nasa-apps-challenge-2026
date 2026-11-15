# Lugares da busca: todas as cidades do mundo com mais de 500 habitantes, com estado e nome em português,
# e os países que faltavam na lista embutida.
#
# Rodar da raiz do repositório, só com Docker (precisa de internet; baixa cerca de 235 MB na primeira vez):
#   docker run --rm -v "$PWD:/repo" -w /repo python:3.12-slim sh -c "pip install -q pyshp shapely && python scripts/places_data.py"
# Os arquivos baixados ficam em .cache/places (fora do git); para outra pasta, passe o caminho no fim.
#
# Fontes:
#   GeoNames (CC BY 4.0, citar "GeoNames"): cities500 (lugares povoados com mais de 500 habitantes),
#     countryInfo (países e territórios) e alternateNamesV2 (nomes em português).
#   Natural Earth (domínio público): estados e províncias, os mesmos da lista embutida.
#
# Saídas:
#   apps/api/data/cities.json.gz   {"adminKeys": [...], "cities": [[nome, nome em português ou "", país, lat, lon,
#                                  posição do estado em adminKeys ou -1], ...]}, da cidade mais populosa para a menos.
#                                  A API lê esse arquivo ao subir e passa a buscar nele, sem depender da rede.
#   packages/contract/src/fixtures/places.json   ganha os países e territórios que o Natural Earth não traz.
#
# Estado de cada cidade: o polígono do Natural Earth que contém a cidade, desde que seja do mesmo país; sem
# polígono, o código do GeoNames que o Natural Earth guarda em cada estado (gn_a1_code) e, por fim, o mais próximo. O identificador é o
# nome do estado em inglês, igual ao da lista embutida, para a busca afunilar de país para estado e cidade.
# Ficam de fora bairros (PPLX) e lugares abandonados, destruídos ou históricos (PPLQ, PPLW, PPLH).
import csv, gzip, io, json, os, sys, urllib.request, zipfile
from collections import Counter

import shapefile
from shapely.geometry import Point, shape
from shapely.strtree import STRtree

CACHE = sys.argv[1] if len(sys.argv) > 1 else ".cache/places"
OUT = "apps/api/data/cities.json.gz"
FIXTURE = "packages/contract/src/fixtures/places.json"
GEONAMES = "https://download.geonames.org/export/dump/"
SOURCES = {
    "cities500.zip": GEONAMES + "cities500.zip",
    "countryInfo.txt": GEONAMES + "countryInfo.txt",
    "alternateNamesV2.zip": GEONAMES + "alternateNamesV2.zip",
    "ne1.zip": "https://naciscdn.org/naturalearth/10m/cultural/ne_10m_admin_1_states_provinces.zip",
}
SKIP = {"PPLX", "PPLQ", "PPLW", "PPLH"}
csv.field_size_limit(1 << 30)


def fetch(name):
    path = os.path.join(CACHE, name)
    if not os.path.exists(path):
        os.makedirs(CACHE, exist_ok=True)
        print("baixando", name, flush=True)
        urllib.request.urlretrieve(SOURCES[name], path + ".part")
        os.rename(path + ".part", path)
    return path


def rows(path, member):
    """Linhas de um arquivo de texto separado por tabulação dentro de um zip, sem extrair."""
    with zipfile.ZipFile(path) as z, z.open(member) as f:
        yield from csv.reader(io.TextIOWrapper(f, encoding="utf-8"), delimiter="\t", quoting=csv.QUOTE_NONE)


def main():
    fixture = json.load(open(FIXTURE, encoding="utf-8"))
    known_states = {(s[2], s[0]) for s in fixture["states"]}

    # estados do Natural Earth: código do GeoNames -> identificador, e os polígonos para quem ficar sem código
    with zipfile.ZipFile(fetch("ne1.zip")) as z:
        z.extractall(os.path.join(CACHE, "ne1"))
    reader = shapefile.Reader(os.path.join(CACHE, "ne1", "ne_10m_admin_1_states_provinces.shp"), encoding="utf-8")
    by_code, polygons, owners = {}, [], []
    for sr in reader.iterShapeRecords():
        rec = sr.record.as_dict()
        # a lista embutida usa o nome em inglês do estado e, na falta dele, o nome local
        cc = rec["iso_a2"]
        name = next((n for n in (rec["name_en"], rec["name"]) if n and (cc, n) in known_states), None)
        if name is None:
            continue
        if rec["gn_a1_code"]:
            by_code[rec["gn_a1_code"]] = name
        geom = shape(sr.shape.__geo_interface__)
        polygons.append(geom if geom.is_valid else geom.buffer(0))
        owners.append((cc, name))
    tree = STRtree(polygons)

    cities, ids = [], {}
    for r in rows(fetch("cities500.zip"), "cities500.txt"):
        if r[7] in SKIP:
            continue
        gid, name, lat, lon, cc, a1, pop = int(r[0]), r[1], float(r[4]), float(r[5]), r[8], r[10], int(r[14] or 0)
        # primeiro o polígono que contém a cidade: em países como a França o Natural Earth divide mais fino que o
        # GeoNames, e vários estados dividem o mesmo código
        state, point = None, Point(lon, lat)
        for i in tree.query(point):
            if owners[i][0] == cc and polygons[i].covers(point):
                state = owners[i][1]
                break
        if state is None:
            state = by_code.get(f"{cc}.{a1}")
            if state is not None and (cc, state) not in known_states:
                state = None
        if state is None:  # no litoral a cidade pode cair fora do polígono: o estado do mesmo país mais perto, até 0,2°
            near = [(polygons[i].distance(point), owners[i][1]) for i in tree.query(point.buffer(0.2)) if owners[i][0] == cc]
            state = min(near)[1] if near else None
        ids[gid] = len(cities)
        cities.append([name, "", cc, round(lat, 4), round(lon, 4), state, pop])
    print(len(cities), "cidades;", sum(1 for c in cities if c[5] is None), "sem estado", flush=True)

    # países que o Natural Earth não traz, com o nome em português vindo dos nomes alternativos
    have = {c[2] for c in fixture["countries"]}
    missing = {}
    for line in open(fetch("countryInfo.txt"), encoding="utf-8"):
        if line.startswith("#"):
            continue
        f = line.rstrip("\n").split("\t")
        if f[0] not in have and f[16]:
            missing[int(f[16])] = [f[4].strip(), f[4].strip(), f[0]]

    # nome em português: o preferido, senão o primeiro que não for histórico nem coloquial
    best = {}
    for r in rows(fetch("alternateNamesV2.zip"), "alternateNamesV2.txt"):
        if r[2] != "pt":
            continue
        gid = int(r[1])
        if gid not in ids and gid not in missing:
            continue
        if (len(r) > 6 and r[6] == "1") or (len(r) > 7 and r[7] == "1"):
            continue
        rank = 0 if len(r) > 4 and r[4] == "1" else 1
        if gid not in best or rank < best[gid][0]:
            best[gid] = (rank, r[3])
    for gid, (_, name) in best.items():
        if gid in ids:
            if name != cities[ids[gid]][0]:
                cities[ids[gid]][1] = name
        else:
            missing[gid][1] = name
    print(sum(1 for c in cities if c[1]), "cidades com nome em português diferente", flush=True)

    # centro e tamanho de um país que faltava: a partir das cidades dele
    added = 0
    for en, pt, cc in missing.values():
        inside = [c for c in cities if c[2] == cc]
        if not inside:
            continue
        lats, lons = [c[3] for c in inside], [c[4] for c in inside]
        span = max(0.3, round(max(max(lats) - min(lats), max(lons) - min(lons)), 1))
        fixture["countries"].append([en, pt, cc, round(sum(lats) / len(lats), 2), round(sum(lons) / len(lons), 2), span])
        added += 1
    fixture["countries"].sort(key=lambda c: c[0])
    with open(FIXTURE, "w", encoding="utf-8") as f:
        json.dump(fixture, f, ensure_ascii=False, separators=(",", ":"))
    print(added, "países acrescentados;", len(fixture["countries"]), "no total", flush=True)

    cities.sort(key=lambda c: -c[6])
    keys = [k for k, _ in Counter(c[5] for c in cities if c[5] is not None).most_common()]
    at = {k: i for i, k in enumerate(keys)}
    packed = [[c[0], c[1], c[2], c[3], c[4], at.get(c[5], -1)] for c in cities]
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with gzip.GzipFile(OUT, "wb", compresslevel=9, mtime=0) as f:
        f.write(json.dumps({"source": "GeoNames cities500 (CC BY 4.0) e Natural Earth", "adminKeys": keys, "cities": packed},
                           ensure_ascii=False, separators=(",", ":")).encode("utf-8"))
    print(OUT, round(os.path.getsize(OUT) / 1e6, 2), "MB", flush=True)


if __name__ == "__main__":
    main()
