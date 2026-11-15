# Interferogramas dos terremotos de 24/06/2026 no norte da Venezuela (La Guaira e Caracas): duas imagens de franjas
# para a cena opcional "laguaira", tiradas dos próprios arquivos NISAR L2 GUNW (HDF5).
#
# Precisa do token do Earthdata no .env da raiz (EARTHDATA_TOKEN) e de internet. Lê só os blocos do recorte, por
# HTTP com leitura parcial (open_h5 e read_rows, do gcov_crop.py), em vez de baixar dois arquivos de 2,3 GB:
# 2 a 3 minutos ao todo, medido em 14/11/2026. Rodar da raiz do repositório, só com Docker (o -B evita um __pycache__
# dentro de scripts/):
#   docker run --rm --env-file .env -v "$PWD:/repo" -w /repo python:3.12-slim sh -c "pip install -q numpy pillow h5py fsspec aiohttp pyproj && python -B scripts/gunw_crop.py"
#
# Grava apps/api/scene-images/laguaira/before-HH.png (par de 06/06 a 18/06, antes dos terremotos) e after-HH.png
# (par de 18/06 a 30/06, que atravessa os terremotos), PNG RGBA de 640 × 640 sobre o bbox, e a entrada "laguaira"
# do manifest.json: product "gunw", a passagem de referência de cada par (referenceDate; date é a segunda) e
# cycleCm. As duas granules estão fixas em PAIRS e são conferidas no catálogo (CMR) e no próprio arquivo. O
# manifest é relido logo antes de gravar; as outras cenas e a chave "source" ficam como estavam.
#
# Método. Um interferograma guarda, em cada ponto, a diferença de fase entre duas passagens: uma volta de fase
# (2π, um ciclo de cor) é meio comprimento de onda de mudança na distância entre o chão e o satélite. Esse valor
# vai para o manifest como cycleCm = 100 · c / (2 · centerFrequency), com a frequência lida do arquivo
# (1,239 GHz: 12,1 cm); se diferir entre os dois arquivos ou sair de 11,5 a 12,5 cm, o script para.
# O arquivo traz duas camadas, na mesma grade UTM (as coordenadas são o centro de cada amostra):
#   1. unwrappedInterferogram/HH/unwrappedPhase, a 80 m: a fase já "desenrolada". É a primeira escolha: a fase é
#      enrolada de novo (e^iφ) e vale a amostra com fase finita, coerência (coherenceMagnitude) de pelo menos
#      COHERENCE_MIN e componente conexa (connectedComponents) diferente de 0 e de 65535 (sem dado).
#   2. wrappedInterferogram/HH/wrappedInterferogram, a 20 m: o interferograma complexo, antes de desenrolar. Entra
#      no lugar da primeira quando menos de LAND_MIN da terra (pela máscara de água do arquivo) fica com dado nos
#      dois pares. É o que acontece aqui: com a camada de 80 m só 34% da terra sobra (medido em 14/11/2026). O
#      desenrolador deixou de fora (componente 0) a serra da costa no par dos terremotos e a metade leste no par
#      de antes, e a coerência abaixo de 0,2 tira ainda mais. Onde as duas têm dado, a fase coincide (desvio de
#      0,18 a 0,20 rad entre a soma de 20 m e a fase de 80 m).
# Grade de saída: 640 × 640 em lat/lon sobre o bbox, linha 0 ao norte. Cada pixel soma as amostras do arquivo cujo
# centro cai nele e fica com o ângulo da soma. Na camada de 20 m são umas 20 amostras complexas por pixel (um
# multilook) e vale o pixel cuja coerência, medida de novo na soma (|Σ I| / Σ |I|/coerência), chega a COHERENCE_MIN.
# O critério não é amostra por amostra porque a coerência de 20 m é estimada com poucas visadas: no mar, onde não
# há sinal, a mediana é 0,22: mais da metade das amostras passaria de 0,2 (sem a máscara de água, o mar sairia
# quase todo opaco). Na soma, a mediana do mar cai para 0,09.
# Ionosfera. Na banda L a ionosfera muda a fase em rampas de dezenas de quilômetros, e o arquivo traz a estimativa
# dela (unwrappedInterferogram/HH/ionospherePhaseScreen, a 80 m, em radianos). A média dela em cada pixel de saída
# é descontada da fase dos dois pares, qualquer que seja a camada. A conferência é o par de antes dos terremotos,
# em que se espera quase a mesma fase na cena toda: o vetor médio dos pixels com dado (1 = fase igual em todos)
# tem comprimento 0,15 sem o desconto e 0,64 com ele; somando a estimativa em vez de subtrair, 0,14 (medido em
# 14/11/2026, sem rede, nos recortes dos dois arquivos). No par dos terremotos o vetor não cresce (0,15 e 0,11),
# como se espera onde o chão se moveu, e as franjas finas da costa ficam onde estavam. O script imprime os dois
# comprimentos de cada par.
# Zero. A fase de um interferograma não tem zero próprio: a de cada par é contada a partir da fase média da
# cena (a direção do vetor médio dos pixels com dado). No par de antes é a fase em que a cena se concentra (vetor
# de 0,64); no dos terremotos o vetor é curto (0,11) e o branco marca só a média, não uma fase dominante. Com isso
# some também a constante da estimativa de ionosfera, que não quer dizer nada (uns −35 rad no segundo arquivo).
# Cor: v = (1 + cos φ) / 2 passa em linha reta por três cores (#0C1B33 em 0, #4C8DFF em 0,5, #FFFFFF em 1):
# branco na fase média da cena, escuro a meio ciclo dela, para um lado ou para o outro. Um ciclo inteiro
# (cycleCm) vai de escuro a branco e de volta a escuro. Um matiz só e nenhum vermelho: o app reserva o vermelho,
# e duas cores opostas seriam lidas como sentido do movimento, que esta imagem não dá. Alfa 255 onde há dado e 0
# onde não há, igual nas duas imagens: pixel sem dado num par fica transparente nos dois. A água fica sempre
# transparente: é água o pixel em que mais da metade das amostras da máscara do arquivo (a de 80 m) está marcada
# como água, num par ou no outro.
#
# Limites. A fase é só a parte do movimento na linha de visada do radar (órbita ascendente, olhando para a
# esquerda), e a cor não diz o sentido. A atmosfera só sai em parte: a ionosfera é descontada pela estimativa do
# arquivo, que no par dos terremotos não há como conferir (a incerteza que o arquivo declara para ela tem mediana
# de 1,9 rad); a troposfera fica, e também desenha manchas e franjas largas. A mancha escura do sudeste (perto de
# 10,30 N 66,67 O) está nos dois pares e some na soma das duas fases, que é o par de 06/06 a 30/06: vem da
# passagem de 18/06, comum aos dois (o mais provável, a atmosfera daquele dia), e não do chão nem dos terremotos.
# A área escura do noroeste do par de antes (perto de 10,59 N 67,02 O) não se repete no outro par e continua de
# causa não conferida (medido em 14/11/2026, sem rede). O produto é provisório (coleção
# NISAR_L2_GUNW_PROVISIONAL_V1). Os vazios são água ou sinal perdido num dos dois pares (coerência baixa, comum
# em encosta íngreme e em mata), não ausência de movimento, e são muitos: com COHERENCE_MIN em 0,2, 62% da terra
# tem dado nos dois pares (metade da imagem); seriam 37% em 0,3, 49% em 0,25 e 74% em 0,15. O limiar é uma
# convenção. A medida do acaso é a água, onde não há sinal: em cada par uns 3% dela passam de 0,2, e 0,6% nos
# dois (0,2% em 0,3, 0,3% em 0,25 e 3,1% em 0,15); abaixo de 0,2 o ruído começa a aparecer. É também por isso que
# a água fica transparente. A coerência medida na soma sai um pouco alta (o denominador soma amostra por amostra)
# e cai onde a fase gira depressa dentro do pixel: nas franjas mais finas, parte dos pixels some por isso.
# No par dos terremotos, as franjas mais finas (manchas na costa; a maior, de uns 70 pixels, perto de 10,60 N
# 67,03 O) ficam a menos de 4 pixels uma da outra, menos do que a tela do app (512 pixels) separa; em 99% dos
# pixels medidos estão a mais de 15 (medido antes do desconto da ionosfera, que é liso e não muda isso). Com um
# bbox de metade do lado ([-67.10, 10.45, -66.80, 10.675], ensaiado sem rede) a mancha maior vai a uns 5 pixels,
# com 5 amostras de 20 m por pixel em vez de 20 e mais pontos soltos no mar.
#
# O token nunca é impresso nem gravado; de um erro de rede sai só o tipo, nunca a mensagem.
import json, os, sys, time, urllib.parse, urllib.request
import numpy as np
from PIL import Image
from gcov_crop import open_h5, read_rows

OUT = "apps/api/scene-images"
NAME = "laguaira"
SIZE = 640
COLLECTION, RELEASE = "C2854335566-ASF", "provisional"  # NISAR L2 GUNW no catálogo da NASA (CMR)
CENTER = [10.55, -66.93]               # o pino da cena: lat, lon
BBOX = [-67.10, 10.25, -66.50, 10.70]  # oeste, sul, leste, norte
STACK, POL = "061_A_007", "HH"         # trilha 61, ascendente, quadro 7
PAIRS = {  # cada par vai da passagem de referência (referenceDate) à segunda (date)
    "before": {"date": "2026-06-18", "referenceDate": "2026-06-06",
               "granule": "NISAR_L2_PR_GUNW_022_061_A_007_023_4000_SH_20260606T095837_20260606T095911_20260618T095836_20260618T095911_P05023_N_F_J_001"},
    "after": {"date": "2026-06-30", "referenceDate": "2026-06-18",
              "granule": "NISAR_L2_PR_GUNW_023_061_A_007_024_4000_SH_20260618T095836_20260618T095911_20260630T095835_20260630T095910_P05023_N_F_J_001"},
}
COHERENCE_MIN = 0.2  # coerência abaixo disso conta como sinal perdido
LAND_MIN = 0.5       # fração da terra com dado abaixo da qual a camada de 80 m dá lugar à de 20 m
COLORS = ("#0C1B33", "#4C8DFF", "#FFFFFF")  # v = 0, 0,5 e 1
LIGHT_SPEED = 299792458.0  # m/s
GRID = "science/LSAR/GUNW/grids/frequencyA"


def h5_url(granule):
    """Endereço HTTPS do arquivo .h5 da granule, pelo catálogo público da NASA (CMR)."""
    q = urllib.parse.urlencode({"collection_concept_id": COLLECTION, "readable_granule_name": granule})
    with urllib.request.urlopen("https://cmr.earthdata.nasa.gov/search/granules.umm_json?" + q, timeout=60) as r:
        items = json.load(r)["items"]
    for it in items:
        for u in it["umm"].get("RelatedUrls", []):
            if u["URL"].startswith("https") and u["URL"].endswith("/" + granule + ".h5"):  # não o _QA_STATS.h5
                return u["URL"]
    sys.exit(f"{granule} sem arquivo .h5 no CMR")


def rects(grp):
    """Janela do arquivo que cobre o bbox e, para cada pixel da grade de saída (SIZE × SIZE em lat/lon, linha 0 ao
    norte), o retângulo de amostras cujo centro cai nele, em linhas e colunas contadas a partir da janela."""
    from pyproj import Transformer
    tr = Transformer.from_crs(4326, int(grp["projection"][()]), always_xy=True)
    x, y = grp["xCoordinates"][()], grp["yCoordinates"][()]  # centros das amostras, em metros (UTM)
    dx, dy = x[1] - x[0], y[1] - y[0]
    w, s, e, n = BBOX
    lons = w + (np.arange(SIZE) + 0.5) / SIZE * (e - w)
    lats = n - (np.arange(SIZE) + 0.5) / SIZE * (n - s)
    LON, LAT = np.meshgrid(lons, lats)
    X, Y = tr.transform(LON, LAT)
    Xe, _ = tr.transform(LON + (e - w) / SIZE / 2, LAT)
    _, Yn = tr.transform(LON, LAT + (n - s) / SIZE / 2)
    # meia largura do pixel de saída em amostras do arquivo, pelos vizinhos projetados; nunca menos de meia
    # amostra: a 80 m o pixel de saída é mais baixo que a amostra e, sem isso, uma linha em cada 35 ficaria vazia
    hx, hy = np.maximum(np.abs(Xe - X) / abs(dx), 0.5), np.maximum(np.abs(Yn - Y) / abs(dy), 0.5)
    cx, cy = (X - x[0]) / dx, (Y - y[0]) / dy
    i0, i1 = np.ceil(cy - hy).astype(int), np.ceil(cy + hy).astype(int)
    j0, j1 = np.ceil(cx - hx).astype(int), np.ceil(cx + hx).astype(int)
    r0, r1, c0, c1 = int(i0.min()), int(i1.max()), int(j0.min()), int(j1.max())
    if c0 < 0 or r0 < 0 or c1 > len(x) or r1 > len(y):
        sys.exit("o bbox sai da grade do arquivo")
    return (r0, r1, c0, c1), (i0 - r0, i1 - r0, j0 - c0, j1 - c0)


def box(a, rect):
    """Soma de a dentro do retângulo de cada pixel de saída, por soma acumulada 2D."""
    i0, i1, j0, j1 = rect
    T = np.pad(a.cumsum(0).cumsum(1), ((1, 0), (1, 0)))
    return T[i1, j1] - T[i0, j1] - T[i1, j0] + T[i0, j0]


def unwrapped(f, fs, url):
    """Primeira escolha: a fase desenrolada de 80 m, enrolada de novo. Devolve a fase de cada pixel de saída, onde
    há amostra válida, onde é terra e onde é água, pela máscara de água do próprio arquivo. Pixel sem amostra da
    máscara não é terra nem água."""
    top = f[GRID]["unwrappedInterferogram"]
    (r0, r1, c0, c1), rect = rects(top[POL])
    read = lambda d: read_rows(d, fs, url, r0, r1, c0, c1, True)
    phase, coherence, component = (read(top[POL][k]) for k in ("unwrappedPhase", "coherenceMagnitude", "connectedComponents"))
    finite = np.isfinite(phase)
    coherent = np.nan_to_num(coherence) >= COHERENCE_MIN
    connected = (component > 0) & (component < 65535)  # 0: fora de toda componente conexa; 65535: sem dado
    ok = finite & coherent & connected
    total = box(np.where(ok, np.exp(1j * np.where(finite, phase, 0).astype(np.float64)), 0), rect)
    valid = box(ok.astype(np.float64), rect) > 0.5
    low = read(top["mask"]) & 0xFF  # bits 0 a 7 em decimal: o dígito das centenas é 1 na água; 255 é amostra sem máscara
    known = box((low != 255).astype(np.float64), rect)
    wet = box((low // 100 == 1).astype(np.float64), rect) * 2
    land, water = (known > 0.5) & (wet <= known), (known > 0.5) & (wet > known)  # sem máscara não é terra nem água
    print(f"    80 m, amostras fora por critério: fase não finita {100 * (~finite).mean():.1f}%, coerência < {COHERENCE_MIN} "
          f"{100 * (~coherent).mean():.1f}%, sem componente conexa {100 * (~connected).mean():.1f}%, qualquer um {100 * (~ok).mean():.1f}%")
    return np.angle(total), valid, land, water


def wrapped(f, fs, url):
    """Segunda escolha: o interferograma complexo de 20 m, somado dentro de cada pixel de saída (multilook). Devolve
    a fase de cada pixel e onde a coerência, medida de novo na soma, chega a COHERENCE_MIN."""
    grp = f[GRID]["wrappedInterferogram"][POL]
    (r0, r1, c0, c1), rect = rects(grp)
    ifg = read_rows(grp["wrappedInterferogram"], fs, url, r0, r1, c0, c1, True).astype(np.complex128)
    coherence = read_rows(grp["coherenceMagnitude"], fs, url, r0, r1, c0, c1, True).astype(np.float64)
    finite = np.isfinite(ifg) & np.isfinite(coherence) & (coherence > 0)
    ifg = np.where(finite, ifg, 0)
    total = box(ifg, rect)
    # |I| / coerência é a potência das duas passagens em cada amostra (√(P1·P2)): o denominador da coerência
    power = box(np.abs(ifg) / np.where(finite, coherence, 1), rect)
    seen = box(finite.astype(np.float64), rect) > 0.5
    coherent = np.abs(total) >= COHERENCE_MIN * np.maximum(power, 1e-6)  # o piso segura o pixel de potência nula
    print(f"    20 m: amostras não finitas {100 * (~finite).mean():.1f}%; pixels de saída com coerência < {COHERENCE_MIN} "
          f"{100 * (seen & ~coherent).mean():.1f}%; sem componente conexa: a camada não tem")
    return np.angle(total), seen & coherent


def ionosphere(f, fs, url):
    """A ionosfera estimada no próprio arquivo (ionospherePhaseScreen, 80 m, em radianos) na grade de saída: a média
    das amostras finitas de cada pixel, nos mesmos retângulos da fase desenrolada, e onde há alguma."""
    grp = f[GRID]["unwrappedInterferogram"][POL]
    (r0, r1, c0, c1), rect = rects(grp)
    screen = read_rows(grp["ionospherePhaseScreen"], fs, url, r0, r1, c0, c1, True).astype(np.float64)
    finite = np.isfinite(screen)
    seen = box(finite.astype(np.float64), rect)
    return box(np.where(finite, screen, 0), rect) / np.maximum(seen, 1), seen > 0.5


def cycle_cm(f):
    """Centímetros de mudança na linha de visada por ciclo de cor (2π de fase): meio comprimento de onda."""
    return round(100 * LIGHT_SPEED / (2 * float(f[GRID]["centerFrequency"][()])), 1)


def paint(phase, valid):
    """RGBA da fase enrolada: v = (1 + cos φ) / 2 nas três cores; sem dado, transparente."""
    lo, mid, hi = (np.array([int(c[i:i + 2], 16) for i in (1, 3, 5)], np.float64) for c in COLORS)
    v = ((1 + np.cos(phase)) / 2)[..., None]
    rgb = np.where(v < 0.5, lo + (mid - lo) * 2 * v, mid + (hi - mid) * (2 * v - 1))
    rgba = np.concatenate([rgb, np.full(v.shape, 255.0)], axis=2) * valid[..., None]
    return Image.fromarray(rgba.round().astype(np.uint8))


def run():
    path = os.path.join(OUT, "manifest.json")
    if not os.path.isfile(path):
        sys.exit(f"{path} não existe: rode da raiz do repositório")
    if not os.environ.get("EARTHDATA_TOKEN", "").strip().strip('"').strip("'"):
        sys.exit("EARTHDATA_TOKEN vazio: defina no .env da raiz e rode com --env-file .env")
    opened, cycle = {}, {}
    for when, pair in PAIRS.items():
        url = h5_url(pair["granule"])
        f, fs = open_h5(url)
        ident = f["science/LSAR/identification"]
        days = [ident[k][()].decode()[:10] for k in ("referenceZeroDopplerStartTime", "secondaryZeroDopplerStartTime")]
        listed = [p.decode() if isinstance(p, bytes) else str(p) for p in f[GRID]["listOfPolarizations"][()]]
        if days != [pair["referenceDate"], pair["date"]] or POL not in listed:
            sys.exit(f"{pair['granule']}: datas {days} e polarizações {listed} não são as esperadas")
        opened[when], cycle[when] = (f, fs, url), cycle_cm(f)
    if cycle["before"] != cycle["after"] or not 11.5 <= cycle["before"] <= 12.5:
        sys.exit(f"ciclo de cor fora do esperado: {cycle} cm (banda L: perto de 12)")
    phase, valid, land, sea = {}, np.ones((SIZE, SIZE), bool), np.ones((SIZE, SIZE), bool), np.zeros((SIZE, SIZE), bool)
    for when in PAIRS:
        t = time.time()
        print(f"  {NAME} {when}, {PAIRS[when]['referenceDate']} -> {PAIRS[when]['date']}:")
        phase[when], ok, dry, wet = unwrapped(*opened[when])
        valid &= ok
        land &= dry  # terra nos dois arquivos
        sea |= wet  # água em um dos dois
        print(f"    80 m: {100 * ok.mean():.1f}% da imagem e {100 * ok[dry].mean():.1f}% da terra com dado, {time.time() - t:.0f} s")
    if not land.any():
        sys.exit("nenhum pixel de terra no recorte, pela máscara de água dos arquivos: confira o BBOX")
    layer = "fase desenrolada de 80 m"
    print(f"  {layer}: {100 * valid[land].mean():.1f}% da terra com dado nos dois pares ({100 * land.mean():.1f}% da imagem é terra)")
    if valid[land].mean() < LAND_MIN:  # terra quase toda sem dado: vale o interferograma complexo
        layer, valid = "interferograma complexo de 20 m", np.ones((SIZE, SIZE), bool)
        for when in PAIRS:
            t = time.time()
            phase[when], ok = wrapped(*opened[when])
            valid &= ok
            print(f"    20 m, {when}: {100 * ok.mean():.1f}% da imagem e {100 * ok[land].mean():.1f}% da terra com dado, {time.time() - t:.0f} s")
        print(f"  {layer}: {100 * valid[land].mean():.1f}% da terra com dado nos dois pares")
    # a água fica transparente: ali não há sinal estável, e o pixel que passa do limiar é acaso ou borda da costa
    print(f"  água: {100 * sea.mean():.1f}% da imagem; sem amostra da máscara: {100 * (~land & ~sea).mean():.1f}%; "
          f"{100 * (valid[sea].mean() if sea.any() else 0):.2f}% da água passava do limiar nos dois pares")
    # a ionosfera estimada no arquivo sai da fase dos dois pares; pixel sem amostra dela fica sem dado
    plain, had = dict(phase), valid & land
    for when in PAIRS:
        screen, seen = ionosphere(*opened[when])
        phase[when] = phase[when] - screen
        valid &= seen
    valid &= land
    print(f"  ionosfera: {100 * (had & ~valid).sum() / land.sum():.2f}% da terra tinha dado e o perdeu por falta de estimativa dela")
    for f, _, _ in opened.values():
        f.close()
    # o zero da fase é arbitrário: cada par é contado a partir da fase média da cena, a direção do vetor médio
    for when in PAIRS:
        bare, fixed = (np.exp(1j * p[valid]).mean() if valid.any() else 0j for p in (plain[when], phase[when]))
        phase[when] = np.angle(np.exp(1j * phase[when]) * np.conj(fixed))
        print(f"  {when}: vetor médio dos pixels com dado {abs(bare):.2f} sem o desconto da ionosfera e {abs(fixed):.2f} com ele")
    if not valid.any():
        sys.exit("nenhum pixel com dado nos dois pares: nada foi gravado")
    # relido agora, antes das imagens: outra tarefa pode ter gravado enquanto esta lia os arquivos, e um manifest
    # quebrado interrompe o script antes de ele mexer nelas
    with open(path, encoding="utf-8") as src:
        manifest = json.load(src)
    manifest.setdefault("scenes", {})[NAME] = {
        "center": CENTER, "bbox": BBOX, "stack": STACK, "polarization": POL, "polarizations": [POL],
        **{when: {**PAIRS[when], "release": RELEASE} for when in PAIRS},
        "validPct": round(float(valid.mean()) * 100, 1), "product": "gunw", "cycleCm": cycle["before"],
    }
    os.makedirs(os.path.join(OUT, NAME), exist_ok=True)
    for when in PAIRS:  # grava num arquivo temporário e troca de uma vez: uma queda no meio não deixa meia imagem
        final = os.path.join(OUT, NAME, f"{when}-{POL}.png")
        paint(phase[when], valid).save(final + ".tmp", format="PNG", optimize=True)
        os.replace(final + ".tmp", final)
    with open(path + ".tmp", "w", encoding="utf-8") as out:
        json.dump(manifest, out, ensure_ascii=False, indent=2)
    os.replace(path + ".tmp", path)
    print(f"{NAME}: GUNW, {layer}, ionosfera descontada, {manifest['scenes'][NAME]['validPct']}% com dado, um ciclo de cor = {cycle['before']} cm")


def main():
    try:
        run()
    except Exception as e:  # só o tipo e a linha: a mensagem de um erro de rede pode trazer o cabeçalho com o token
        tb = e.__traceback__
        while tb.tb_next:
            tb = tb.tb_next
        sys.exit(f"{NAME}: falhou com {type(e).__name__} em {os.path.basename(tb.tb_frame.f_code.co_filename)}:{tb.tb_lineno}")


if __name__ == "__main__":
    main()
