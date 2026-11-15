import { useSyncExternalStore } from "react";

/**
 * MEDIDAS DE DESEMPENHO. Dois grupos:
 * - momentos do Nexxus, medidos por nós: quando o globo fica pronto, quando as cenas chegam, quanto demora a imagem
 *   de radar de uma cena, a conta do mapa de mudança e a da compressão de pulso;
 * - métricas padrão do navegador (biblioteca web-vitals): TTFB, FCP, LCP, CLS e INP, mais as tarefas longas,
 *   que são os travamentos de mais de 50 ms.
 * Medir é barato e fica sempre ligado; o painel só aparece com ?perf=1 no endereço (components/PerfPanel.tsx).
 * Cada medida também vira uma entrada "nexxus:<id>" na linha do tempo do navegador (aba Performance).
 */
export type MetricId = "ttfb" | "fcp" | "lcp" | "cls" | "inp" | "scenes" | "map" | "radar" | "change" | "pulse" | "longTasks" | "longest";
export type Rating = "good" | "fair" | "poor";

export interface Sample {
  /** Último valor: milissegundos, menos `cls` (sem unidade) e `longTasks` (contagem). */
  value: number;
  /** Quantas vezes foi medido. */
  count: number;
  /** O pior valor visto. */
  worst: number;
}

/** A ordem em que aparecem no painel. */
export const METRICS: MetricId[] = ["ttfb", "fcp", "lcp", "scenes", "map", "radar", "change", "pulse", "inp", "cls", "longTasks", "longest"];

/**
 * Até onde é bom e a partir de onde é ruim. Para as métricas do navegador, os limites publicados pelo Google
 * (web.dev/vitals). Para as nossas, o que cabe numa demo: o globo em até 2,5 s, a imagem de radar em até 1 s e
 * cada conta dentro de um ou dois quadros de animação.
 */
const LIMITS: Record<MetricId, [good: number, poor: number]> = {
  ttfb: [800, 1800], fcp: [1800, 3000], lcp: [2500, 4000], cls: [0.1, 0.25], inp: [200, 500],
  scenes: [1500, 4000], map: [2500, 5000], radar: [1000, 3000], change: [16, 50], pulse: [16, 50],
  longTasks: [5, 20], longest: [100, 300],
};

export function rate(id: MetricId, value: number): Rating {
  const [good, poor] = LIMITS[id];
  return value <= good ? "good" : value <= poor ? "fair" : "poor";
}

/** Junta uma medida nova ao que já havia. */
export function addSample(previous: Sample | undefined, value: number): Sample {
  return { value, count: (previous?.count ?? 0) + 1, worst: Math.max(previous?.worst ?? value, value) };
}

/** O resumo que o botão de copiar leva: valor, pior valor, quantas medidas e a avaliação de cada métrica. */
export function report(samples: ReadonlyMap<MetricId, Sample>): Record<string, { value: number; worst: number; count: number; rating: Rating }> {
  const round = (n: number) => Math.round(n * 1000) / 1000;
  return Object.fromEntries(METRICS.filter((id) => samples.has(id)).map((id) => {
    const s = samples.get(id)!;
    return [id, { value: round(s.value), worst: round(s.worst), count: s.count, rating: rate(id, s.value) }];
  }));
}

// ---- o que foi medido nesta página ----
let samples: ReadonlyMap<MetricId, Sample> = new Map();
const listeners = new Set<() => void>();
let pending = false;

/** Registra uma medida. */
export function record(id: MetricId, value: number): void {
  const next = new Map(samples);
  next.set(id, addSample(samples.get(id), value));
  samples = next;
  // o aviso sai depois: uma medida pode ser registrada no meio do desenho de um componente (a simulação do pulso),
  // e o React não deixa atualizar outro componente nessa hora
  if (pending) return;
  pending = true;
  queueMicrotask(() => { pending = false; listeners.forEach((notify) => notify()); });
}

/** Registra há quanto tempo a página abriu, só na primeira vez: serve para "pronto em X ms". */
export function recordSinceStart(id: MetricId): void {
  if (samples.has(id) || typeof performance === "undefined") return;
  const now = performance.now();
  try { performance.measure(`nexxus:${id}`, { start: 0, end: now }); } catch { /* navegador sem a linha do tempo */ }
  record(id, now);
}

/** Mede uma conta feita de uma vez só e devolve o resultado dela. */
export function timed<T>(id: MetricId, run: () => T): T {
  if (typeof performance === "undefined") return run();
  const start = performance.now();
  const result = run();
  const end = performance.now();
  try { performance.measure(`nexxus:${id}`, { start, end }); } catch { /* idem */ }
  record(id, end - start);
  return result;
}

/** Mede algo que termina depois (uma imagem carregando): chame o que ela devolve quando acabar. */
export function stopwatch(id: MetricId): () => void {
  if (typeof performance === "undefined") return () => undefined;
  const start = performance.now();
  return () => {
    const end = performance.now();
    try { performance.measure(`nexxus:${id}`, { start, end }); } catch { /* idem */ }
    record(id, end - start);
  };
}

let started = false;
/** Liga as métricas do navegador. Chamado uma vez, ao abrir a página. */
export function startVitals(): void {
  if (started || typeof window === "undefined") return;
  started = true;
  void import("web-vitals").then(({ onCLS, onFCP, onINP, onLCP, onTTFB }) => {
    // reportAllChanges: o valor aparece e se atualiza enquanto a página está aberta, sem esperar a aba fechar
    const all = { reportAllChanges: true };
    onTTFB((m) => record("ttfb", m.value));
    onFCP((m) => record("fcp", m.value));
    onLCP((m) => record("lcp", m.value), all);
    onCLS((m) => record("cls", m.value), all);
    onINP((m) => record("inp", m.value), all);
  }).catch(() => { /* sem a biblioteca, ficam só as nossas medidas */ });
  try {
    let count = 0, longest = 0;
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) { count++; longest = Math.max(longest, entry.duration); }
      record("longTasks", count);
      record("longest", longest);
    }).observe({ type: "longtask", buffered: true });
  } catch { /* navegador sem medida de tarefas longas (Safari, Firefox) */ }
}

/** As medidas, atualizadas a cada registro. */
export function usePerf(): ReadonlyMap<MetricId, Sample> {
  return useSyncExternalStore((notify) => { listeners.add(notify); return () => { listeners.delete(notify); }; }, () => samples);
}
