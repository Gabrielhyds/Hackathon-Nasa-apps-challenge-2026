import type { Pass } from "@nexxus/contract";

/**
 * Catálogo público da NASA (CMR): busca de passagens do NISAR por ponto, sem login.
 * Funções puras, sem rede: a consulta fica em passes.service.ts.
 */

/** Coleções GCOV do NISAR, da mais confiável para a menos. Numa repetição, vale a primeira. */
export const NISAR_GCOV_COLLECTIONS = [
  "C3622241360-ASF", // validada
  "C2854338529-ASF", // provisória
  "C3622214170-ASF", // beta
] as const;

/** O pedaço de um granule (formato UMM-G) que interessa aqui. */
export interface CmrGranule {
  umm: {
    GranuleUR?: string;
    TemporalExtent?: { RangeDateTime?: { BeginningDateTime?: string } };
    AdditionalAttributes?: { Name: string; Values?: string[] }[];
  };
}

export interface CmrResponse {
  items?: CmrGranule[];
}

/**
 * Endereço da busca de uma coleção num ponto. Ordem da mais recente para a mais antiga,
 * para o limite de 200 cortar as passagens antigas, não as novas. O CMR pede `lon,lat`.
 */
export function cmrUrl(collection: string, lat: number, lon: number): string {
  const params = new URLSearchParams({
    collection_concept_id: collection,
    point: `${lon},${lat}`,
    page_size: "200",
    sort_key: "-start_date",
  });
  return `https://cmr.earthdata.nasa.gov/search/granules.umm_json?${params}`;
}

/** "HH+HV" → "HH + HV", como o front escreve. */
export function formatPolarization(raw: string): string {
  return raw.split("+").map((p) => p.trim()).filter(Boolean).join(" + ");
}

/** Converte um granule em passagem. Devolve `null` se faltar algum atributo essencial. */
export function granuleToPass(g: CmrGranule): Pass | null {
  const attr = (name: string) => g.umm.AdditionalAttributes?.find((a) => a.Name === name)?.Values?.[0];
  const begin = g.umm.TemporalExtent?.RangeDateTime?.BeginningDateTime ?? "";
  const date = /^\d{4}-\d{2}-\d{2}/.test(begin) ? begin.slice(0, 10) : null;
  const dir = attr("ASCENDING_DESCENDING")?.toUpperCase();
  const direction = dir === "ASCENDING" ? "ascending" : dir === "DESCENDING" ? "descending" : null;
  const track = Number.parseInt(attr("TRACK_NUMBER") ?? "", 10);
  const frame = Number.parseInt(attr("FRAME_NUMBER") ?? "", 10);
  if (!date || !direction || !Number.isFinite(track) || !Number.isFinite(frame)) return null;
  const pol = attr("FREQUENCY_A_POLARIZATION_CONCAT");
  return {
    date, direction, track, frame,
    polarization: pol ? formatPolarization(pol) : "—",
    product: attr("PRODUCT_TYPE") ?? "GCOV",
  };
}

/**
 * Junta as respostas das coleções (na ordem de `NISAR_GCOV_COLLECTIONS`) numa lista de passagens,
 * da mais recente para a mais antiga. Uma passagem é a data, a direção e a trilha: a mesma aquisição
 * em duas coleções, ou um ponto na borda entre dois quadros, conta uma vez só (vale a primeira).
 */
export function cmrToPasses(responses: CmrResponse[]): Pass[] {
  const seen = new Map<string, Pass>();
  for (const response of responses) {
    for (const g of response.items ?? []) {
      const pass = granuleToPass(g);
      if (!pass) continue;
      const key = `${pass.date}|${pass.direction}|${pass.track}`;
      if (!seen.has(key)) seen.set(key, pass);
    }
  }
  return [...seen.values()].sort((a, b) => b.date.localeCompare(a.date) || a.track - b.track);
}
