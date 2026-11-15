import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { scenesResponse } from "@nexxus/contract";
import type { Lang, Polarization, Release, Scene, SceneAcquisition, SceneKind, ScenesResponse } from "@nexxus/contract";

/** Pasta com as imagens reais das cenas, gerada por scripts/scene_images.py, gcov_crop.py e gunw_crop.py. */
export const SCENE_IMAGES_DIR = join(__dirname, "..", "scene-images");

/** Uma passagem no manifest. `release` é a versão do produto na coleção do catálogo que guarda a granule. */
export interface SceneImagePass {
  date: string;
  granule: string;
  release?: string;
  /** Só em interferograma (product "gunw"): a primeira passagem do par; `date` é a segunda. */
  referenceDate?: string;
}

export interface SceneImageEntry {
  center: [number, number];
  bbox: [number, number, number, number];
  stack: string;
  /** Para mostrar: "HH + HV" */
  polarization: string;
  /** Uma imagem por polarização e data: before-HH.png, after-HV.png… */
  polarizations: Polarization[];
  before: SceneImagePass;
  after: SceneImagePass;
  /**
   * Passagens anteriores à `before`, da mais antiga para a mais recente, da mesma órbita e do mesmo recorte: a série
   * fica com mais de duas datas. Só no dado calibrado (scripts/gcov_crop.py, chave `earlier` em SCENES). Cada uma
   * tem um arquivo por polarização: earlier-<data>-HH.png. Opcional; se algo nelas não fechar, a cena sai com duas.
   */
  earlier?: SceneImagePass[];
  /**
   * "gcov" quando scripts/gcov_crop.py trocou o preview pelo recorte calibrado do arquivo GCOV.
   * "gunw" nos interferogramas de scripts/gunw_crop.py: before e after são dois pares de passagens.
   */
  product?: "gcov" | "gunw";
  /** Parte do recorte com dado nas duas datas, em %. O resto sai preto na imagem. */
  validPct?: number;
  /** Escala de cinza do dado calibrado: o gamma0, em dB, que vira branco em cada polarização. */
  scale?: { quantity?: string; topDb?: Partial<Record<Polarization, number>> };
  /** Só em interferograma: centímetros de mudança na linha de visada por ciclo de cor. */
  cycleCm?: number;
}

export interface SceneImageManifest {
  scenes?: Record<string, SceneImageEntry>;
}

/**
 * Versão das imagens de uma cena: muda quando a entrada do manifest muda (datas, recorte, granule). Vai no endereço
 * para o navegador não reaproveitar do cache a imagem antiga de mesmo nome depois que o script roda de novo.
 */
export function imageVersion(m: SceneImageEntry): string {
  let h = 5381;
  for (const c of JSON.stringify(m)) h = ((h * 33) ^ c.charCodeAt(0)) >>> 0;
  return h.toString(36);
}

/** Arquivos que uma cena precisa ter na pasta dela. */
export const sceneImageFiles = (m: SceneImageEntry): string[] =>
  (["before", "after"] as const).flatMap((when) => m.polarizations.map((p) => `${when}-${p}.png`));

/** Arquivos de uma passagem anterior da série. */
export const earlierImageFiles = (m: SceneImageEntry, date: string): string[] => m.polarizations.map((p) => `earlier-${date}-${p}.png`);

/**
 * As passagens anteriores que podem entrar na série: só no dado calibrado (a mesma escala em todas as datas), em
 * ordem, todas antes da `before`. Qualquer coisa fora disso e a lista inteira é ignorada: melhor a série de duas
 * datas, conferida, do que uma série com um degrau errado.
 */
export function usableEarlier(m: SceneImageEntry): SceneImagePass[] {
  const list = m.earlier;
  if (m.product !== "gcov" || !Array.isArray(list) || !list.length) return [];
  const ok = list.every((p, i) => typeof p === "object" && p !== null && typeof p.date === "string" && DATE.test(p.date)
    && (i === 0 || p.date > list[i - 1].date));
  return ok && list[list.length - 1].date < m.before.date ? list : [];
}

export function readManifest(dir: string = SCENE_IMAGES_DIR): SceneImageManifest {
  const path = join(dir, "manifest.json");
  if (!existsSync(path)) return {};
  try {
    const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));
    return typeof parsed === "object" && parsed !== null ? (parsed as SceneImageManifest) : {};
  } catch {
    return {};
  }
}

const RELEASES: readonly Release[] = ["beta", "provisional", "validated"];
const DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * A entrada tem tudo o que o resto do código lê? O manifest é gravado pelos scripts, mas pode ser editado à mão:
 * entrada incompleta ou de outro formato vale como entrada ausente, em vez de derrubar GET /scenes. Confere só o
 * formato, não o sentido (recorte invertido, data que não existe): o manifest de verdade é conferido contra a
 * fixture num teste.
 */
function complete(m: SceneImageEntry | undefined): m is SceneImageEntry {
  if (typeof m !== "object" || m === null) return false;
  const numbers = (a: unknown, n: number) => Array.isArray(a) && a.length === n && a.every((x) => typeof x === "number" && Number.isFinite(x));
  const pass = (p: SceneImagePass | undefined) => typeof p === "object" && p !== null && typeof p.date === "string" && DATE.test(p.date);
  return Array.isArray(m.polarizations) && m.polarizations.length > 0 && m.polarizations.every((p) => p === "HH" || p === "HV")
    && numbers(m.center, 2) && numbers(m.bbox, 4) && pass(m.before) && pass(m.after);
}

/**
 * Tipos de cena pedidos em `GET /scenes?include=`. Aceita um valor, vários separados por vírgula ou o parâmetro
 * repetido (o Express entrega uma lista); o que não for conhecido é ignorado.
 */
export function parseInclude(raw: unknown): SceneKind[] {
  const parts = (Array.isArray(raw) ? raw : [raw]).flatMap((x) => (typeof x === "string" ? x.split(",") : []));
  return parts.some((p) => p.trim() === "interferogram") ? ["interferogram"] : [];
}

/**
 * Detalhes da imagem que valem a pena repassar: a parte do recorte com dado e, só no dado calibrado, o topo da
 * escala de cada polarização. Valor ausente ou malformado no manifest não vira campo.
 */
function imageryDetails(m: SceneImageEntry): Scene["imageryDetails"] {
  const validPct = typeof m.validPct === "number" && m.validPct >= 0 && m.validPct <= 100 ? m.validPct : undefined;
  const topDb = scaleTop(m);
  if (validPct === undefined && !topDb) return undefined;
  return { ...(topDb ? { topDb } : {}), ...(validPct !== undefined ? { validPct } : {}) };
}

/** Topo da escala de cada polarização, em dB de gamma0: só no dado calibrado e só se houver um número para cada uma. */
function scaleTop(m: SceneImageEntry): Partial<Record<Polarization, number>> | undefined {
  const scale = m.scale;
  if (m.product !== "gcov" || !scale || scale.quantity !== "gamma0 amplitude" || !scale.topDb) return undefined;
  const out: Partial<Record<Polarization, number>> = {};
  for (const p of m.polarizations) {
    const db = scale.topDb[p];
    if (typeof db !== "number" || !Number.isFinite(db)) return undefined;
    out[p] = db;
  }
  return out;
}

/**
 * Põe as imagens reais nas cenas que têm: as duas passagens do manifest, com uma imagem por polarização, e antes
 * delas as passagens anteriores (`earlier`), quando o manifest as traz e os arquivos existem.
 * Data, bbox e polarizações vêm do manifest, junto com a imagem, para o mapa posicionar o recorte certo e o mapa
 * de mudança medir a área certa; a granule e a versão de cada passagem e os detalhes da imagem vêm de lá também.
 * Uma cena cujo centro mudou desde que as imagens foram geradas fica com o exemplo: as imagens são de outro lugar.
 * Interferograma não tem exemplo que o substitua: sem as imagens de scripts/gunw_crop.py (arquivos, centro, as
 * duas datas de referência), a cena sai da lista.
 * `exists` confere se os arquivos estão lá; `base` é o endereço público da pasta.
 */
export function withSceneImages(
  scenes: Scene[], manifest: SceneImageManifest, base: string, exists: (id: string, files: string[]) => boolean,
): Scene[] {
  return scenes.flatMap((s): Scene[] => {
    const interferogram = s.kind === "interferogram";
    const none = interferogram ? [] : [s];
    const m = manifest.scenes?.[s.id];
    if (!complete(m) || !exists(s.id, sceneImageFiles(m))) return none;
    if (Math.abs(m.center[0] - s.lat) > 1e-6 || Math.abs(m.center[1] - s.lon) > 1e-6) return none;
    // imagem de fase não serve de brilho, nem o contrário
    if ((m.product === "gunw") !== interferogram) return none;
    // a fase vem só em HH (no contrato, images.HH): com outra polarização a cena sairia sem ela
    if (interferogram && !(m.polarizations.length === 1 && m.polarizations[0] === "HH")) return none;
    const pair = (when: "before" | "after") => { const d = m[when].referenceDate; return typeof d === "string" && DATE.test(d) ? d : undefined; };
    if (interferogram && !(pair("before") && pair("after"))) return none;
    const v = imageVersion(m);
    const url = (file: string) => `${base}/${encodeURIComponent(s.id)}/${file}?v=${v}`;
    const origin = (pass: SceneImagePass) => {
      const release = RELEASES.find((r) => r === pass.release);
      return { ...(typeof pass.granule === "string" && pass.granule ? { granule: pass.granule } : {}), ...(release ? { release } : {}) };
    };
    const acquisition = (when: "before" | "after"): SceneAcquisition => {
      const pass = m[when];
      return {
        date: pass.date,
        images: Object.fromEntries(m.polarizations.map((p) => [p, url(`${when}-${p}.png`)])),
        ...origin(pass),
        ...(interferogram ? { referenceDate: pair(when) } : {}),
      };
    };
    // série mais longa: só entra inteira, com todos os arquivos no lugar
    const extra = interferogram ? [] : usableEarlier(m);
    const earlier: SceneAcquisition[] = extra.length && exists(s.id, extra.flatMap((p) => earlierImageFiles(m, p.date)))
      ? extra.map((pass) => ({ date: pass.date, images: Object.fromEntries(m.polarizations.map((p) => [p, url(`earlier-${pass.date}-${p}.png`)])), ...origin(pass) }))
      : [];
    const details = imageryDetails(m);
    const cycleCm = interferogram && typeof m.cycleCm === "number" && m.cycleCm > 0 && Number.isFinite(m.cycleCm) ? m.cycleCm : undefined;
    return [{
      ...s, bbox: m.bbox, polarizations: m.polarizations, acquisitions: [...earlier, acquisition("before"), acquisition("after")],
      imagery: m.product === "gunw" ? "gunw" : m.product === "gcov" ? "gcov" : "preview",
      ...(details ? { imageryDetails: details } : {}),
      ...(cycleCm !== undefined ? { cycleCm } : {}),
    }];
  });
}

/**
 * As cenas como a API as serve: as de exemplo, com as imagens reais e os dados do manifest onde houver.
 * `GET /scenes` devolve isto e o agente recebe as mesmas cenas como contexto. `include` acrescenta os tipos de cena
 * que só entram a pedido (interferograma). Atrás de outro proxy ou domínio, PUBLIC_API_URL ajusta o endereço
 * público das imagens.
 */
export function servedScenes(lang: Lang, include: readonly SceneKind[] = []): ScenesResponse {
  const res = scenesResponse(lang, include);
  const base = `${(process.env.PUBLIC_API_URL ?? "/api").replace(/\/$/, "")}/scene-images`;
  const has = (id: string, files: string[]) => files.every((f) => existsSync(join(SCENE_IMAGES_DIR, id, f)));
  return { ...res, scenes: withSceneImages(res.scenes, readManifest(), base, has) };
}
