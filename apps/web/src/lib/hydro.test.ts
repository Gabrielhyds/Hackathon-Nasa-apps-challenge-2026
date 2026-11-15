import { describe, expect, it } from "vitest";
import { scenes } from "@nexxus/contract";
import type { WaterSample } from "@nexxus/contract";
import { axisMax, chartSpan, dailyWithin, daysApart, gaugeDays, nearest, opticalGap, orbitLinks, peakSample, referenceRange, timeFraction, usualRevisit } from "./hydro";

const taquari = scenes("en").find((s) => s.id === "taquari")!;
const samples = taquari.waterSeries!.samples, context = taquari.floodContext!, gauge = taquari.riverGauge!;

describe("régua de cheia do Taquari, na série calibrada", () => {
  it("a série vem em ordem, nas duas órbitas, e cabe no eixo do tempo", () => {
    const span = chartSpan(samples, context);
    expect(new Set(samples.map((s) => s.track)).size).toBe(2);
    samples.forEach((s, i) => {
      if (i) expect(s.date > samples[i - 1].date).toBe(true);
      expect(timeFraction(span, s.date)).toBeGreaterThan(0);
      expect(timeFraction(span, s.date)).toBeLessThan(1);
    });
    expect(span.start >= context.start && span.end <= context.end).toBe(true);
  });
  it("o pico é a passagem da noite seguinte à cheia de 22/07, com cerca de 53 km²", () => {
    const peak = peakSample(samples);
    expect(peak.date).toBe("2026-07-23");
    expect(peak.newWaterKm2).toBeGreaterThan(49);
    expect(peak.newWaterKm2).toBeLessThan(56);
    expect(peak.reference).toBeUndefined();
    expect(axisMax(samples)).toBe(60);
  });
  it("o piso de cada órbita sai das passagens de referência dela e fica muito abaixo do pico", () => {
    const peak = peakSample(samples), floor = referenceRange(samples, peak.track)!;
    expect(floor.low).toBeLessThanOrEqual(floor.high);
    expect(floor.high).toBeLessThan(2);
    expect(referenceRange(samples, 999)).toBeNull();
  });
  it("somando as duas órbitas, o ritmo normal é uma passagem a cada 4 ou 8 dias", () => {
    expect(usualRevisit(samples)).toEqual([4, 8]);
  });
  it("só liga passagens da mesma órbita, a um ciclo de distância", () => {
    const links = orbitLinks(samples);
    expect(links.length).toBeGreaterThan(0);
    links.forEach(([a, b]) => { expect(a.track).toBe(b.track); expect(daysApart(a.date, b.date)).toBeLessThanOrEqual(12); });
    const s = (date: string, track: number): WaterSample => ({ date, track, direction: "descending", newWaterKm2: 1 });
    // um buraco de 24 dias na mesma órbita não vira reta; a outra órbita no meio não quebra a ligação
    expect(orbitLinks([s("2026-07-01", 1), s("2026-07-05", 2), s("2026-07-13", 1), s("2026-08-06", 1)]).map(([a, b]) => [a.date, b.date]))
      .toEqual([["2026-07-01", "2026-07-13"]]);
  });
  it("junta as leituras do rio por dia", () => {
    const days = gaugeDays(gauge);
    expect(days.map((d) => d.date)).toEqual(["2026-07-22", "2026-07-23"]);
    expect(days[1].readings.length).toBe(2);
  });
  it("acha a fonte independente mais próxima e a janela sem visão óptica", () => {
    expect(nearest(context.independent, "2026-07-23")?.item.date).toBe("2026-07-25");
    const gap = opticalGap(context, "2026-07-23");
    expect(gap.before && gap.before < "2026-07-23").toBe(true);
    expect(gap.days).toBeGreaterThan(7);
  });
  it("recorta a série diária no eixo, um valor por dia", () => {
    const span = chartSpan(samples, context), rain = dailyWithin(context.rainMm, context.start, span);
    expect(rain.length).toBe(daysApart(span.start, span.end) + 1);
    expect(rain[0].date).toBe(span.start);
    expect(rain[rain.length - 1].date).toBe(span.end);
    expect(dailyWithin([1, 2, 3, 4], "2026-07-01", { start: "2026-07-02", end: "2026-07-03" })).toEqual([{ date: "2026-07-02", value: 2 }, { date: "2026-07-03", value: 3 }]);
  });
});
