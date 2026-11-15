import maplibregl, { type RasterSourceSpecification } from "maplibre-gl";

/**
 * FUNDO DO MAPA: imagem de satélite.
 * Blue Marble da NASA (GIBS), público e sem chave, até 500 m por pixel; mais perto que isso, Esri World Imagery.
 *
 * O mundo inteiro e os arredores de cada cena já vêm junto com a página, em pacotes gerados por
 * `npm run tiles` (apps/web/public/tiles). O mapa lê primeiro deles, depois da rede, e por último amplia
 * a imagem menos detalhada que tiver. Assim o globo e as cenas aparecem mesmo sem internet.
 * `VITE_TILE_PACKS` troca a lista de pacotes; vazio desliga e usa só a rede.
 */
const PACKS = (import.meta.env.VITE_TILE_PACKS ?? "tiles/globe,tiles/regions").split(",").map((s) => s.trim()).filter(Boolean);
/** Extensão do arquivo de imagens de cada pacote. Só muda onde a hospedagem recusa `.bin`. */
const PACK_EXT = import.meta.env.VITE_TILE_PACK_EXT || "bin";
const GIBS = "https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/BlueMarble_ShadedRelief_Bathymetry/default/GoogleMapsCompatible_Level8/{z}/{y}/{x}.jpeg";
const ESRI = "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}";
const SIZE = 256;

/** Fonte do fundo (mundo inteiro) e a fonte de detalhe para quando se chega perto. */
export function imagerySources(): { base: RasterSourceSpecification; detail: RasterSourceSpecification } {
  if (PACKS.length) registerPacks();
  return {
    base: { type: "raster", tiles: [PACKS.length ? "nexxuspack://{z}/{x}/{y}" : GIBS], tileSize: SIZE, maxzoom: 8, attribution: "NASA GIBS · Blue Marble" },
    detail: { type: "raster", tiles: [ESRI], tileSize: SIZE, minzoom: 8, maxzoom: 17, attribution: "Esri, Maxar, Earthstar Geographics" },
  };
}

/**
 * NUVENS DO ÚLTIMO DIA: cor verdadeira do VIIRS (satélite NOAA-20), servida pelo GIBS. Uma imagem do mundo inteiro por
 * dia, montada com as passagens diurnas (cada lugar é visto no começo da tarde, hora local). Não é ao vivo: o dia de
 * hoje ainda está pela metade, então a tela usa o último dia completo. Não existe no modo sem rede.
 */
const VIIRS = (day: string) => `https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/VIIRS_NOAA20_CorrectedReflectance_TrueColor/default/${day}/GoogleMapsCompatible_Level9/{z}/{y}/{x}.jpg`;

/** Folga depois da meia-noite UTC até o dia anterior estar inteiro no GIBS: as últimas passagens levam horas para entrar. */
const DAY_LAG_MS = 6 * 3_600_000;

/** Dias a tentar (AAAA-MM-DD, UTC), do último completo para trás. Pura, para teste. */
export function cloudDayCandidates(now: Date, count = 3, skip: readonly string[] = []): string[] {
  const start = now.getTime() - DAY_LAG_MS;
  if (Number.isNaN(start)) return [];
  const out: string[] = [];
  for (let i = 1; out.length < count && i <= count + skip.length; i++) {
    const day = new Date(start - i * 86_400_000).toISOString().slice(0, 10);
    if (!skip.includes(day)) out.push(day);
  }
  return out;
}

/**
 * Último dia (AAAA-MM-DD) cuja imagem já está publicada: confere o tile do mundo inteiro de cada candidato e recua
 * um dia se faltar. `skip` exclui dias que já falharam no mapa.
 */
export async function latestCloudDay(signal?: AbortSignal, skip: readonly string[] = [], now = new Date()): Promise<string> {
  for (const day of cloudDayCandidates(now, 3, skip)) {
    // HEAD: só a resposta, sem baixar a imagem
    const ok = await fetch(VIIRS(day).replace("{z}/{y}/{x}", "0/0/0"), { method: "HEAD", signal, cache: "no-store" }).then((r) => r.ok, () => false);
    if (ok) return day;
  }
  throw new Error("Nenhuma imagem recente do VIIRS");
}

/** Brilho (maior canal, 0 a 255) abaixo do qual o pixel é "sem dado", e a partir do qual é imagem inteira. */
const NO_DATA: readonly [number, number] = [6, 20];

/**
 * Onde o VIIRS não tem imagem (a noite polar, a faixa ainda não coberta), o JPEG vem preto. Deixa esses pixels
 * transparentes, com uma rampa curta para a borda não serrilhar, e o Blue Marble aparece por baixo em vez de um
 * buraco preto no globo. Mexe só no canal alfa de `rgba`. Pura, para teste.
 */
export function clearNoData(rgba: Uint8ClampedArray): void {
  const [lo, hi] = NO_DATA;
  for (let i = 0; i < rgba.length; i += 4) {
    const top = Math.max(rgba[i], rgba[i + 1], rgba[i + 2]);
    if (top < hi) rgba[i + 3] = top <= lo ? 0 : Math.round((255 * (top - lo)) / (hi - lo));
  }
}

let cloudsRegistered = false;
function registerClouds() {
  if (cloudsRegistered) return;
  cloudsRegistered = true;
  maplibregl.addProtocol("nexxusclouds", async (request, abort) => {
    const [day, z, y, x] = request.url.slice("nexxusclouds://".length).split("/");
    const response = await fetch(VIIRS(day).replace("{z}", z).replace("{y}", y).replace("{x}", x), { signal: abort.signal });
    if (!response.ok) throw new Error(`Sem nuvens para ${z}/${y}/${x}`);
    const bitmap = await createImageBitmap(await response.blob());
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height), ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Sem canvas para as nuvens");
    ctx.drawImage(bitmap, 0, 0);
    const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height);
    clearNoData(pixels.data);
    ctx.putImageData(pixels, 0, 0);
    return { data: await (await canvas.convertToBlob({ type: "image/png" })).arrayBuffer() };
  });
}

export function cloudSource(day: string): RasterSourceSpecification {
  registerClouds();
  return { type: "raster", tiles: [`nexxusclouds://${day}/{z}/{y}/{x}`], tileSize: SIZE, maxzoom: 8, attribution: "VIIRS (NOAA-20) · NASA GIBS" };
}

interface Pack { index: Record<string, [number, number]>; data: ArrayBuffer }
/**
 * Pacotes já carregados por uma tag <script> (o build de preview faz isso; ver scripts/preview-build.mjs).
 * Serve onde a página não consegue buscar os próprios arquivos com fetch, como numa moldura isolada.
 */
interface EmbeddedPack { index: Pack["index"]; data: string }
function embedded(name: string): Pack | null {
  const found = (globalThis as { __NEXXUS_PACKS__?: Record<string, EmbeddedPack> }).__NEXXUS_PACKS__?.[name];
  if (!found) return null;
  const text = atob(found.data), bytes = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i++) bytes[i] = text.charCodeAt(i);
  return { index: found.index, data: bytes.buffer };
}
const EMPTY: Pack = { index: {}, data: new ArrayBuffer(0) };
let registered = false;

/** Tempo entre o primeiro pacote chegar e os outros começarem a baixar: o globo aparece antes. */
const PACK_GAP_MS = 1200;

/**
 * Procura uma imagem em vários pacotes, na ordem, sem baixar todos de uma vez. O primeiro (o mundo inteiro) começa
 * já; os outros (os arredores das cenas, bem maiores) só começam depois que ele chegou e passou `gapMs`, ou antes,
 * no momento em que alguém pede uma imagem que o primeiro não tem (um link direto para uma cena, por exemplo).
 * `load` busca um pacote pelo nome e nunca rejeita. Sem dependência do mapa, para poder ser testada.
 */
export function packLookup<P extends { index: Record<string, unknown> }>(
  names: readonly string[], load: (name: string) => Promise<P>, gapMs = PACK_GAP_MS,
  wait: (run: () => void, ms: number) => void = (run, ms) => { setTimeout(run, ms); },
): (key: string) => Promise<{ pack: P; key: string } | null> {
  const started: (Promise<P> | undefined)[] = names.map(() => undefined);
  const start = (i: number) => (started[i] ??= load(names[i]));
  if (names.length) void start(0).then(() => wait(() => { for (let i = 1; i < names.length; i++) void start(i); }, gapMs));
  return async (key) => {
    for (let i = 0; i < names.length; i++) {
      const pack = await start(i);
      if (key in pack.index) return { pack, key };
    }
    return null;
  };
}

function registerPacks() {
  if (registered) return;
  registered = true;
  const load = async (name: string): Promise<Pack> => {
    const ready = embedded(name);
    if (ready) return ready;
    const url = new URL(name, document.baseURI).href;
    try {
      const [index, data] = await Promise.all([
        fetch(`${url}.json`).then((r) => { if (!r.ok) throw new Error(String(r.status)); return r.json() as Promise<Pack["index"]>; }),
        fetch(`${url}.${PACK_EXT}`).then((r) => { if (!r.ok) throw new Error(String(r.status)); return r.arrayBuffer(); }),
      ]);
      return { index, data };
    } catch {
      return EMPTY; // pacote ausente: o mapa segue só com a rede
    }
  };
  // procura no primeiro pacote (o mundo inteiro) antes de esperar, ou mesmo de pedir, os outros
  const lookup = packLookup(PACKS, load);
  async function find(key: string): Promise<ArrayBuffer | null> {
    const hit = await lookup(key);
    if (!hit) return null;
    const at = hit.pack.index[key];
    return hit.pack.data.slice(at[0], at[0] + at[1]);
  }
  maplibregl.addProtocol("nexxuspack", async (request, abort) => {
    const [z, x, y] = request.url.slice("nexxuspack://".length).split("/").map(Number);
    const exact = await find(`${z}/${x}/${y}`);
    if (exact) return { data: exact };
    // fora dos pacotes: tenta a rede, com pouco tempo de espera para não travar a demo sem internet
    try {
      const url = GIBS.replace("{z}", String(z)).replace("{y}", String(y)).replace("{x}", String(x));
      const response = await fetch(url, { signal: AbortSignal.any([abort.signal, AbortSignal.timeout(6000)]) });
      if (response.ok) return { data: await response.arrayBuffer() };
    } catch {
      if (abort.signal.aborted) throw new Error("cancelado");
    }
    // sem rede: amplia o pedaço correspondente da imagem menos detalhada mais próxima
    for (let up = 1; up <= z; up++) {
      const parent = await find(`${z - up}/${x >> up}/${y >> up}`);
      if (!parent) continue;
      const n = 2 ** up, part = SIZE / n;
      const bitmap = await createImageBitmap(new Blob([parent]));
      const canvas = new OffscreenCanvas(SIZE, SIZE);
      canvas.getContext("2d")?.drawImage(bitmap, (x % n) * part, (y % n) * part, part, part, 0, 0, SIZE, SIZE);
      return { data: await (await canvas.convertToBlob({ type: "image/jpeg", quality: 0.85 })).arrayBuffer() };
    }
    throw new Error(`Sem imagem para ${z}/${x}/${y}`);
  });
}
