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
 * NUVENS DE AGORA: GeoColor do GOES-East, servido pelo GIBS. Imagem nova a cada 10 minutos, cerca de uma hora
 * depois da captura, só sobre as Américas e o Atlântico. Não existe no modo sem rede.
 */
const GOES = (time: string) => `https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/GOES-East_ABI_GeoColor/default/${time}/GoogleMapsCompatible_Level7/{z}/{y}/{x}.png`;

const STEP = 10 * 60_000;
/**
 * Tiles conferidos antes de usar uma hora: o mundo inteiro e a grade do zoom 3 que cobre as Américas. O GIBS publica
 * uma hora aos poucos, tile por tile, e às vezes pula uma hora inteira; poucos tiles conferidos deixavam passar isso.
 */
const PROBES = ["0/0/0", ...[2, 3, 4, 5].flatMap((y) => [2, 3, 4, 5].map((x) => `3/${y}/${x}`))];

/** Horas a tentar, da mais nova para trás, de 10 em 10 minutos. Pura, para teste. */
export function cloudTimeCandidates(latest: string, count = 6, skip: readonly string[] = []): string[] {
  const start = Date.parse(latest);
  if (Number.isNaN(start)) return [];
  const out: string[] = [];
  for (let i = 0; out.length < count && i < count + skip.length; i++) {
    const time = new Date(start - i * STEP).toISOString().replace(/\.\d{3}Z$/, "Z");
    if (!skip.includes(time)) out.push(time);
  }
  return out;
}

async function tilesExist(time: string, signal?: AbortSignal): Promise<boolean> {
  const results = await Promise.all(PROBES.map((z) =>
    // HEAD: só a resposta, sem baixar a imagem
    fetch(GOES(time).replace("{z}/{y}/{x}", z), { method: "HEAD", signal, cache: "no-store" }).then((r) => r.ok, () => false)));
  return results.every(Boolean);
}

/**
 * Hora (ISO, UTC) da imagem mais recente que já está publicada. O GIBS diz a hora mais nova no cabeçalho quando se
 * pede `default`, mas anuncia antes de todos os tiles dela existirem (404, às vezes 500). Por isso cada hora é
 * conferida em vários tiles e, se faltar algum, recua 10 minutos (até 2 horas). `skip` exclui horas que já falharam no mapa.
 */
export async function latestCloudTime(signal?: AbortSignal, skip: readonly string[] = []): Promise<string> {
  const response = await fetch(GOES("default").replace("{z}/{y}/{x}", "0/0/0"), { signal, cache: "no-store" });
  const latest = response.headers.get("layer-time-actual");
  if (!response.ok || !latest) throw new Error("Sem imagem recente do GOES-East");
  for (const time of cloudTimeCandidates(latest, 12, skip)) {
    if (await tilesExist(time, signal)) return time;
  }
  throw new Error("Nenhuma imagem recente do GOES-East completa");
}

/**
 * Onde as nuvens de agora existem: o GOES-East fica parado sobre as Américas e só enxerga essa faixa de longitudes.
 * Fora dela não há nuvem nenhuma na tela, e a legenda não pode dizer que há.
 */
export const GOES_EAST_LON: readonly [number, number] = [-125, -20];
export function inGoesEastView(lon: number): boolean {
  const l = ((lon + 540) % 360) - 180;
  return l >= GOES_EAST_LON[0] && l <= GOES_EAST_LON[1];
}

export const cloudSource = (time: string): RasterSourceSpecification =>
  ({ type: "raster", tiles: [GOES(time)], tileSize: SIZE, maxzoom: 7, attribution: "GOES-East GeoColor (NOAA, CIRA) via NASA GIBS" });

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
