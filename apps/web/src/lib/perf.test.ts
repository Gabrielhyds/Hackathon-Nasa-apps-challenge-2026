import { describe, expect, it } from "vitest";
import { METRICS, addSample, rate, report, type MetricId, type Sample } from "./perf";

describe("medidas de desempenho", () => {
  it("avalia cada métrica pelos seus limites", () => {
    expect(rate("lcp", 2500)).toBe("good");
    expect(rate("lcp", 3000)).toBe("fair");
    expect(rate("lcp", 4001)).toBe("poor");
    expect(rate("cls", 0.05)).toBe("good");
    expect(rate("cls", 0.3)).toBe("poor");
    expect(rate("change", 8)).toBe("good");
    expect(rate("inp", 350)).toBe("fair");
  });
  it("guarda o último valor, o pior e quantas vezes mediu", () => {
    let s = addSample(undefined, 12);
    expect(s).toEqual({ value: 12, count: 1, worst: 12 });
    s = addSample(s, 40);
    s = addSample(s, 9);
    expect(s).toEqual({ value: 9, count: 3, worst: 40 });
  });
  it("o resumo traz só o que foi medido, na ordem do painel, com a avaliação", () => {
    const samples = new Map<MetricId, Sample>([["map", { value: 1800.4567, count: 1, worst: 1800.4567 }], ["lcp", { value: 4200, count: 2, worst: 4200 }]]);
    const out = report(samples);
    expect(Object.keys(out)).toEqual(["lcp", "map"]);
    expect(out.map).toEqual({ value: 1800.457, worst: 1800.457, count: 1, rating: "good" });
    expect(out.lcp.rating).toBe("poor");
  });
  it("toda métrica tem lugar no painel", () => {
    expect(new Set(METRICS).size).toBe(METRICS.length);
    for (const id of METRICS) expect(["good", "fair", "poor"]).toContain(rate(id, 0));
  });
});
