import type { AskRequest, AskResponse, Lang, Pass, Place, PlaceKind, Scene } from "./types";
import { criteria as criteriaFor, scenes as scenesFor } from "./fixtures/scenes";
import placesJson from "./fixtures/places.json";

const DAY = 86_400_000;

/**
 * Passagens inventadas, mas coerentes com o NISAR: revisita de 12 dias,
 * uma trilha ascendente e uma descendente por ponto.
 */
export function mockPasses(lat: number, lon: number, now: number = Date.now()): Pass[] {
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 87.5) return [];
  const h = Math.abs(Math.round(lat * 10) * 7919 + Math.round(lon * 10) * 104729);
  const polarization = Math.abs(lat) > 66 ? "HH" : "HH + HV";
  const frame = 1 + (Math.round((90 - lat) / 2.4) % 176);
  const out: Pass[] = [];
  const tracks: [Pass["direction"], number, number][] = [
    ["ascending", h % 12, 1 + (h % 173)],
    ["descending", (h * 7 + 5) % 12, 1 + ((h * 3) % 173)],
  ];
  for (const [direction, lag, track] of tracks) {
    for (let i = 0; i < 5; i++) {
      out.push({
        date: new Date(now - (lag + 12 * i) * DAY).toISOString().slice(0, 10),
        direction, track, frame, polarization,
        product: i % 2 ? "GSLC" : "GCOV",
        isExample: true,
      });
    }
  }
  return out.sort((a, b) => b.date.localeCompare(a.date));
}

// ---------- lugares ----------
/** [nome em inglês, nome em português, código do país, lat, lon, tamanho em graus] */
type RegionRow = [string, string, string, number, number, number];
/** [nome em inglês, nome em português, código do país, lat, lon, estado em inglês ou ""] */
export type CityRow = [string, string, string, number, number, string];
/**
 * Fonte: Natural Earth (domínio público) e GeoNames. 253 países, 4,6 mil estados e 7,3 mil cidades, estas por população.
 * A API troca as cidades pela lista completa do GeoNames (`useCities`); o front sem API fica com estas.
 */
const DATA = placesJson as unknown as { countries: RegionRow[]; states: RegionRow[]; cities: CityRow[] };

const plain = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
interface Entry {
  kind: PlaceKind;
  names: [string, string];
  keys: [string, string];
  cc: string;
  /** Estado: o próprio nome em inglês. Cidade: o estado onde fica. País: vazio. */
  adminKey: string;
  lat: number;
  lon: number;
  spanDeg?: number;
}
let INDEX: Entry[] | null = null;
let CITIES: CityRow[] = DATA.cities;

/**
 * Troca as cidades embutidas por uma lista maior, da mais populosa para a menos (a ordem decide quem aparece primeiro).
 * A API usa para carregar todas as cidades do mundo, que não cabem na página.
 */
export function useCities(rows: CityRow[]): void {
  CITIES = rows;
  INDEX = null;
}
const COUNTRY = new Map<string, RegionRow>();
const STATE = new Map<string, RegionRow>();

function index(): Entry[] {
  if (INDEX) return INDEX;
  for (const c of DATA.countries) if (c[2]) COUNTRY.set(c[2], c);
  for (const s of DATA.states) STATE.set(`${s[2]}|${s[0]}`, s);
  const region = (kind: PlaceKind) => (r: RegionRow): Entry =>
    ({ kind, names: [r[0], r[1]], keys: [plain(r[0]), plain(r[1])], cc: r[2], adminKey: kind === "state" ? r[0] : "", lat: r[3], lon: r[4], spanDeg: r[5] });
  INDEX = [
    ...DATA.countries.map(region("country")),
    ...DATA.states.map(region("state")),
    ...CITIES.map((r): Entry => ({ kind: "city", names: [r[0], r[1]], keys: [plain(r[0]), plain(r[1])], cc: r[2], adminKey: r[5], lat: r[3], lon: r[4] })),
  ];
  return INDEX;
}

export interface PlaceSearchOptions {
  kind?: PlaceKind | "all";
  lang?: Lang;
  limit?: number;
  /** Só lugares dentro deste país (código de duas letras). */
  countryCode?: string;
  /** Só cidades deste estado (`Place.adminKey`). Exige `countryCode`. */
  adminKey?: string;
}

/**
 * Busca países, estados e cidades na lista embutida. Ignora acentos e maiúsculas,
 * e aceita o nome em qualquer um dos dois idiomas ("Alemanha" e "Germany" acham o mesmo país).
 * Com `countryCode` ou `adminKey`, a busca fica restrita a esse lugar e a consulta pode ser vazia:
 * devolve os estados em ordem alfabética e as cidades por população.
 */
export function searchPlaces(query: string, options: PlaceSearchOptions = {}): Place[] {
  const { kind = "all", lang = "en", countryCode, adminKey } = options;
  const scoped = Boolean(countryCode);
  const limit = options.limit ?? (scoped ? 40 : 8);
  const q = plain(query.trim());
  if (q.length < 2 && !(scoped && q.length === 0)) return [];
  const col = lang === "pt" ? 1 : 0;
  const starts: Entry[] = [];
  const contains: Entry[] = [];
  for (const e of index()) {
    if (kind !== "all" && e.kind !== kind) continue;
    if (scoped) {
      if (e.kind === "country" || e.cc !== countryCode) continue;
      if (adminKey && (e.kind !== "city" || e.adminKey !== adminKey)) continue;
    }
    if (!q) { starts.push(e); continue; }
    const at = Math.min(...e.keys.map((k) => { const i = k.indexOf(q); return i < 0 ? Infinity : i; }));
    if (at === 0) starts.push(e);
    else if (at !== Infinity && contains.length < limit) contains.push(e);
  }
  if (q) {
    // nome exato primeiro; no resto vale a ordem da lista: países, estados e cidades por população
    const exact = (e: Entry) => (e.keys.includes(q) ? 0 : 1);
    starts.sort((a, b) => exact(a) - exact(b));
  } else {
    // listando o que há dentro de um lugar: estados em ordem alfabética antes das cidades
    const order = (e: Entry) => (e.kind === "state" ? 0 : 1);
    starts.sort((a, b) => order(a) - order(b) || (a.kind === "state" ? a.names[col].localeCompare(b.names[col], lang) : 0));
  }
  return [...starts, ...contains].slice(0, limit).map((e) => ({
    kind: e.kind,
    name: e.names[col],
    admin: e.kind === "city" && e.adminKey ? STATE.get(`${e.cc}|${e.adminKey}`)?.[col] : undefined,
    country: e.kind === "country" ? undefined : COUNTRY.get(e.cc)?.[col],
    countryCode: e.cc || undefined,
    adminKey: e.adminKey || undefined,
    lat: e.lat,
    lon: e.lon,
    spanDeg: e.spanDeg,
  }));
}

// ---------- agente ----------
const ASK_TEXT = {
  en: {
    lead: (name: string, label: string, score: number) => `${name} tells the clearest story among the selected scenes. Its strength is “${label.toLowerCase()}” (${score} out of 100).`,
    wins: (name: string, label: string, a: number, b: number) => `${name} does better on “${label.toLowerCase()}” (${a} against ${b}).`,
    none: (b: string, a: string) => `${b} does not beat ${a} on any criterion.`,
  },
  pt: {
    lead: (name: string, label: string, score: number) => `${name} tem a história mais clara entre as cenas marcadas. O ponto forte é “${label.toLowerCase()}” (${score} de 100).`,
    wins: (name: string, label: string, a: number, b: number) => `${name} ganha em “${label.toLowerCase()}” (${a} contra ${b}).`,
    none: (b: string, a: string) => `${b} não supera ${a} em nenhum critério.`,
  },
};

/** Resposta de exemplo: compara as cenas marcadas pelas notas, sem modelo nenhum. */
export function mockAsk(req: AskRequest, scenes?: Scene[]): AskResponse {
  const lang: Lang = req.lang === "pt" ? "pt" : "en";
  const all = scenes ?? scenesFor(lang);
  const criteria = criteriaFor(lang);
  const T = ASK_TEXT[lang];
  const chosen = all.filter((s) => req.sceneIds.includes(s.id));
  const list = (chosen.length ? chosen : all.slice(0, 2))
    .map((s) => ({ s, avg: criteria.reduce((a, c) => a + (s.scores[c.id] ?? 0), 0) / criteria.length }))
    .sort((a, b) => b.avg - a.avg);
  const [a, b] = list;
  const best = criteria.reduce((p, c) => ((a.s.scores[c.id] ?? 0) > (a.s.scores[p.id] ?? 0) ? c : p));
  let answer = `${T.lead(a.s.name, best.label, a.s.scores[best.id])} ${a.s.summary}`;
  // a ressalva da cena acompanha o resumo: quem lê a resposta precisa dela tanto quanto quem olha a imagem
  if (a.s.caveat) answer += " " + a.s.caveat;
  if (b) {
    const gain = criteria.map((c) => ({ c, d: (b.s.scores[c.id] ?? 0) - (a.s.scores[c.id] ?? 0) })).sort((x, y) => y.d - x.d)[0];
    answer += " " + (gain.d > 0 ? T.wins(b.s.name, gain.c.label, b.s.scores[gain.c.id], a.s.scores[gain.c.id]) : T.none(b.s.name, a.s.name));
  }
  return { answer, citations: list.map((x) => ({ sceneId: x.s.id })), isExample: true };
}
