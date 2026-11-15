import type { FloodContext, GaugeReading, WaterSample } from "@nexxus/contract";

/**
 * RÉGUA DE CHEIA: contas sobre a série de água aberta nova de uma cena (`scene.waterSeries`), medida no dado
 * calibrado por scripts/water_series.py. Aqui ficam o pico, o piso de cada órbita (as passagens de referência),
 * o intervalo entre passagens, as ligações que o gráfico pode traçar e o que as fontes independentes
 * (`scene.floodContext`) diziam perto de cada data.
 *
 * A medida é a água aberta NOVA: não é a área alagada nem os km² do mapa de mudança. Não somar com nenhuma das duas.
 */
const DAY = 86_400_000;
export const dayNumber = (iso: string) => Math.round(Date.parse(iso.slice(0, 10) + "T00:00:00Z") / DAY);
export const daysApart = (a: string, b: string) => dayNumber(b) - dayNumber(a);
export const isoDay = (n: number) => new Date(n * DAY).toISOString().slice(0, 10);

export interface Span { start: string; end: string }
/** Posição de uma data no eixo do tempo, de 0 a 1. */
export const timeFraction = (span: Span, iso: string) => daysApart(span.start, iso) / daysApart(span.start, span.end);

/**
 * Eixo do tempo do gráfico: da primeira à última passagem, com uma folga de cada lado para a chuva de antes e os
 * dias de depois, sem sair do período que o contexto cobre.
 */
export function chartSpan(samples: WaterSample[], context?: Span, padBefore = 7, padAfter = 9): Span {
  let start = dayNumber(samples[0].date) - padBefore, end = dayNumber(samples[samples.length - 1].date) + padAfter;
  if (context) { start = Math.max(start, dayNumber(context.start)); end = Math.min(end, dayNumber(context.end)); }
  return { start: isoDay(start), end: isoDay(end) };
}

/** A passagem com mais água nova. */
export function peakSample(samples: WaterSample[]): WaterSample {
  return samples.reduce((best, s) => (s.newWaterKm2 > best.newWaterKm2 ? s : best), samples[0]);
}

/**
 * Piso da medida numa órbita: o menor e o maior valor das passagens de referência dela (águas baixas). Cada órbita
 * vê o chão de um lado e numa hora do dia, então cada uma tem o seu. `null` se a órbita não tem referência.
 */
export function referenceRange(samples: WaterSample[], track: number): { low: number; high: number } | null {
  const values = samples.filter((s) => s.reference && s.track === track).map((s) => s.newWaterKm2);
  return values.length ? { low: Math.min(...values), high: Math.max(...values) } : null;
}

/**
 * Trechos que o gráfico pode ligar: passagens seguidas da mesma órbita, a no máximo `maxDays` dias uma da outra
 * (um ciclo do NISAR). Órbitas diferentes não se comparam, e um buraco maior não vira reta.
 */
export function orbitLinks(samples: WaterSample[], maxDays = 12): [WaterSample, WaterSample][] {
  const last = new Map<number, WaterSample>(), out: [WaterSample, WaterSample][] = [];
  for (const s of samples) {
    const prev = last.get(s.track);
    if (prev && daysApart(prev.date, s.date) <= maxDays) out.push([prev, s]);
    last.set(s.track, s);
  }
  return out;
}

/** Os intervalos mais comuns entre passagens seguidas (somando as órbitas): o ritmo normal da série. */
export function usualRevisit(samples: WaterSample[]): number[] {
  const count = new Map<number, number>();
  samples.slice(1).forEach((s, i) => { const g = daysApart(samples[i].date, s.date); count.set(g, (count.get(g) ?? 0) + 1); });
  return [...count.entries()].sort((a, b) => b[1] - a[1]).slice(0, 2).map(([g]) => g).sort((a, b) => a - b);
}

/** O topo do eixo de água: a dezena acima do maior valor da série, contando a faixa. */
export function axisMax(samples: WaterSample[]): number {
  return Math.max(10, Math.ceil(Math.max(...samples.map((s) => Math.max(s.newWaterKm2, s.highKm2 ?? 0))) / 10) * 10);
}

/** As leituras do rio juntas por dia, na ordem em que vieram: uma linha vertical por dia no gráfico. */
export function gaugeDays(readings: GaugeReading[]): { date: string; readings: GaugeReading[] }[] {
  const days = new Map<string, GaugeReading[]>();
  for (const r of readings) days.set(r.date, [...(days.get(r.date) ?? []), r]);
  return [...days.entries()].map(([date, list]) => ({ date, readings: list })).sort((a, b) => a.date.localeCompare(b.date));
}

/** O item de data mais próxima, e a quantos dias fica (negativo: antes). */
export function nearest<T extends { date: string }>(items: T[], iso: string): { item: T; days: number } | null {
  let best: { item: T; days: number } | null = null;
  for (const item of items) {
    const days = daysApart(iso, item.date);
    if (!best || Math.abs(days) < Math.abs(best.days)) best = { item, days };
  }
  return best;
}

/**
 * Janela sem visão óptica em volta de uma data: o último dia antes e o primeiro depois em que um satélite óptico
 * viu o recorte com menos de `maxCloud`% de nuvem. `null` quando não houve nenhum daquele lado.
 */
export function opticalGap(context: Pick<FloodContext, "optical">, iso: string, maxCloud = 50): { before: string | null; after: string | null; days: number | null } {
  const clear = context.optical.filter((o) => o.cloudPct < maxCloud).map((o) => o.date).sort();
  const before = clear.filter((d) => d <= iso).pop() ?? null, after = clear.find((d) => d > iso) ?? null;
  return { before, after, days: before && after ? daysApart(before, after) : null };
}

/** Os valores de uma série diária (que começa em `seriesStart`) que caem dentro do eixo, com o dia de cada um. */
export function dailyWithin<T>(values: T[], seriesStart: string, span: Span): { date: string; value: T }[] {
  const first = dayNumber(seriesStart), from = dayNumber(span.start), to = dayNumber(span.end);
  return values.map((value, i) => ({ date: isoDay(first + i), value })).filter((_, i) => first + i >= from && first + i <= to);
}
