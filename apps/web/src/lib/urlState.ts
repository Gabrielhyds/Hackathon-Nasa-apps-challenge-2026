import type { Lang, Place, Polarization } from "@nexxus/contract";
import { isAudience, type Audience } from "./audience";
import type { Steps } from "./series";

/**
 * ESTADO NO ENDEREÇO. O que está aberto na tela vai para a query string, para um link levar
 * outra pessoa (ou uma cena do vídeo) direto ao mesmo ponto:
 *   ?scene=labrea&view=change&pol=HV&steps=1,4&compare=labrea,sindh&tab=ask&lang=pt&aud=analyze&lab=fringes&perf=1&place=-22.9,-47.1,Campinas
 * Só entra no endereço o que difere do padrão, então a página inicial continua com endereço limpo.
 */
export type Tab = "scenes" | "passes" | "ask";
export type View = "swipe" | "change" | "optical";
/** Painéis do laboratório: o hidrograma de radar, a compressão de pulso e a régua de franjas. */
export type Lab = "hydro" | "pulse" | "fringes";
export const LABS: Lab[] = ["hydro", "pulse", "fringes"];

export interface UrlState {
  scene?: string;
  tab?: Tab;
  view?: View;
  /** Polarização da imagem de radar. Só vai para o endereço quando não é HH. */
  pol?: Polarization;
  /** Par de passagens comparado na cena aberta (índices na série). Só vai quando não é primeira contra última. */
  steps?: Steps;
  compare?: string[];
  place?: Place;
  lang?: Lang;
  /** Público da leitura. Só vai para o endereço quando não é explorar. */
  aud?: Audience;
  /** Painel do laboratório aberto por cima do mapa. */
  lab?: Lab;
  /** Mostra o painel de medidas de desempenho. Ver lib/perf.ts. */
  perf?: boolean;
}

const TABS: Tab[] = ["scenes", "passes", "ask"];
const KINDS: Place["kind"][] = ["city", "state", "country"];
const round = (n: number) => Math.round(n * 1000) / 1000;

export function parseUrlState(search: string): UrlState {
  const q = new URLSearchParams(search), out: UrlState = {};
  const scene = q.get("scene");
  if (scene) out.scene = scene;
  const tab = q.get("tab") as Tab | null;
  if (tab && TABS.includes(tab)) out.tab = tab;
  const view = q.get("view");
  if (view === "change" || view === "optical") out.view = view;
  if (q.get("pol") === "HV") out.pol = "HV";
  const steps = (q.get("steps") ?? "").split(",").map(Number);
  if (steps.length === 2 && steps.every((n) => Number.isInteger(n) && n >= 0) && steps[0] < steps[1]) out.steps = [steps[0], steps[1]];
  const compare = q.get("compare");
  if (compare !== null) out.compare = compare.split(",").map((s) => s.trim()).filter(Boolean).slice(0, 3);
  const aud = q.get("aud");
  if (isAudience(aud) && aud !== "explore") out.aud = aud;
  const lab = q.get("lab") as Lab | null;
  if (lab && LABS.includes(lab)) out.lab = lab;
  if (q.get("perf") === "1") out.perf = true;
  const lang = q.get("lang");
  if (lang === "en" || lang === "pt") out.lang = lang;
  // place = lat,lon,nome[,tipo[,tamanho em graus]]
  const [lat, lon, name, kind, span] = (q.get("place") ?? "").split(",");
  const la = Number(lat), lo = Number(lon);
  if (lat && lon && Number.isFinite(la) && Number.isFinite(lo) && Math.abs(la) <= 90 && Math.abs(lo) <= 180) {
    out.place = {
      kind: KINDS.includes(kind as Place["kind"]) ? (kind as Place["kind"]) : "city",
      name: name?.trim() || `${la}, ${lo}`, lat: la, lon: lo,
      ...(Number(span) > 0 ? { spanDeg: Number(span) } : {}),
    };
  }
  return out;
}

const OURS = ["scene", "view", "pol", "steps", "compare", "tab", "place", "lang", "aud", "lab", "perf"];

/**
 * Monta a query string. Devolve "" quando tudo está no padrão.
 * `current` é a query atual da página: parâmetros que não são nossos (de quem hospeda a página, por exemplo) ficam.
 */
export function buildUrlState(state: UrlState, current = ""): string {
  const q = new URLSearchParams(current);
  for (const key of OURS) q.delete(key);
  if (state.scene) q.set("scene", state.scene);
  if (state.view === "change" || state.view === "optical") q.set("view", state.view);
  if (state.pol && state.pol !== "HH") q.set("pol", state.pol);
  if (state.steps) q.set("steps", state.steps.join(","));
  if (state.compare) q.set("compare", state.compare.join(","));
  if (state.tab && state.tab !== "scenes") q.set("tab", state.tab);
  if (state.place) {
    const p = state.place, name = p.name.replace(/,/g, " ");
    q.set("place", [round(p.lat), round(p.lon), name, ...(p.kind !== "city" || p.spanDeg ? [p.kind] : []), ...(p.spanDeg ? [p.spanDeg] : [])].join(","));
  }
  if (state.lang) q.set("lang", state.lang);
  if (state.aud && state.aud !== "explore") q.set("aud", state.aud);
  if (state.lab) q.set("lab", state.lab);
  if (state.perf) q.set("perf", "1");
  const text = q.toString();
  return text ? `?${text}` : "";
}
