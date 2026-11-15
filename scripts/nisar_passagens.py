# Passagens reais do NISAR sobre um ponto, por órbita (STACK_ID = trilha, direção e quadro), do catálogo público
# da NASA (CMR, sem login). Serve para escolher stack, before e after de uma cena em SCENES, no scene_images.py.
# Só a biblioteca padrão do Python:
#   python scripts/nisar_passagens.py <lat> <lon> <nome>      (por exemplo: -22.9 -47.06 campinas)
# Imprime uma linha por órbita (direção, polarização e datas) e grava gran_<nome>.json na pasta atual, com data,
# direção, trilha, quadro, polarização, contorno do quadro e endereço do preview de cada passagem. Não commitar o JSON.
import json, urllib.request, urllib.parse, collections, sys
COLS=["C3622241360-ASF","C2854338529-ASF","C3622214170-ASF"]
def granules(lat,lon):
    out=[]
    for c in COLS:
        url="https://cmr.earthdata.nasa.gov/search/granules.umm_json?"+urllib.parse.urlencode({"collection_concept_id":c,"point":f"{lon},{lat}","page_size":200,"sort_key":"start_date"})
        with urllib.request.urlopen(url, timeout=60) as r: d=json.load(r)
        for it in d["items"]:
            u=it["umm"]; aa={a["Name"]:a["Values"] for a in u.get("AdditionalAttributes",[])}
            pts=u["SpatialExtent"]["HorizontalSpatialDomain"]["Geometry"]["GPolygons"][0]["Boundary"]["Points"]
            browse=[x["URL"] for x in u["RelatedUrls"] if x["URL"].startswith("https") and x["URL"].endswith("_LATLON.png")]
            out.append({"id":u["GranuleUR"],"date":u["TemporalExtent"]["RangeDateTime"]["BeginningDateTime"][:10],"stack":aa.get("STACK_ID",["?"])[0],
              "dir":aa.get("ASCENDING_DESCENDING",["?"])[0],"track":aa.get("TRACK_NUMBER",["?"])[0],"frame":aa.get("FRAME_NUMBER",["?"])[0],
              "pol":aa.get("FREQUENCY_A_POLARIZATION_CONCAT",["?"])[0],"poly":[(p["Longitude"],p["Latitude"]) for p in pts],"browse":browse[0] if browse else None})
    return out
if __name__=="__main__":
    lat,lon=float(sys.argv[1]),float(sys.argv[2])
    gs=granules(lat,lon); by=collections.defaultdict(list)
    for g in gs: by[g["stack"]].append(g)
    for s,l in by.items():
        l.sort(key=lambda g:g["date"])
        print(s, l[0]["dir"], l[0]["pol"], len(l), "datas:", " ".join(g["date"][2:] for g in l))
    json.dump(gs, open(f"gran_{sys.argv[3]}.json","w"))
