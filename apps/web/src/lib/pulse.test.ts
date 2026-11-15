import { describe, expect, it } from "vitest";
import { fft, measuredOutputSnrDb, pulseFigures, simulatePulse } from "./pulse";

describe("FFT", () => {
  it("acha a frequência de uma senoide e volta ao sinal original", () => {
    const n = 64, re = new Float64Array(n), im = new Float64Array(n);
    for (let k = 0; k < n; k++) re[k] = Math.cos((2 * Math.PI * 5 * k) / n);
    const original = Float64Array.from(re);
    fft(re, im);
    expect(re[5]).toBeCloseTo(n / 2, 6);
    expect(re[n - 5]).toBeCloseTo(n / 2, 6);
    expect(Math.abs(re[7])).toBeLessThan(1e-9);
    fft(re, im, true);
    for (let k = 0; k < n; k++) expect(re[k]).toBeCloseTo(original[k], 9);
  });
  it("recusa tamanho que não é potência de 2", () => {
    expect(() => fft(new Float64Array(12), new Float64Array(12))).toThrow();
  });
});

describe("compressão de pulso", () => {
  it("ganho é banda vezes duração e a resolução é c/2B", () => {
    const f = pulseFigures({ bandwidthMHz: 20, durationUs: 25 });
    expect(f.gain).toBeCloseTo(500, 6);
    expect(f.gainDb).toBeCloseTo(27, 1);
    expect(f.resolutionM).toBeCloseTo(7.49, 2);
    expect(f.pulseLengthM).toBeCloseTo(3747, 0);
  });
  it("sem ruído, o pico de um alvo vale 1 e cai no lugar do alvo", () => {
    const sim = simulatePulse({ bandwidthMHz: 20, durationUs: 20, snrDb: 60, separationM: 0, seed: 1 });
    let at = 0;
    for (let k = 0; k < sim.n; k++) if (sim.compressed[k] > sim.compressed[at]) at = k;
    expect(at).toBe(sim.targets[0]);
    expect(sim.compressed[at]).toBeCloseTo(1, 2);
  });
  it("o eco enterrado no ruído sai da correlação com o ganho B·T", () => {
    const p = { bandwidthMHz: 20, durationUs: 25, snrDb: -10, separationM: 0, seed: 7 };
    const out = measuredOutputSnrDb(simulatePulse(p));
    expect(Math.abs(out - (p.snrDb + pulseFigures(p).gainDb))).toBeLessThan(2);
  });
  it("separa dois alvos mais afastados que a resolução", () => {
    const sim = simulatePulse({ bandwidthMHz: 40, durationUs: 20, snrDb: 20, separationM: 30, seed: 3 });
    const [a, b] = sim.targets, mid = Math.round((a + b) / 2);
    expect(sim.compressed[a]).toBeGreaterThan(0.5);
    expect(sim.compressed[b]).toBeGreaterThan(0.5);
    expect(sim.compressed[mid]).toBeLessThan(0.1);
  });
  it("o mesmo número de semente dá o mesmo ruído", () => {
    const p = { bandwidthMHz: 5, durationUs: 20, snrDb: -5, separationM: 0, seed: 11 };
    expect(simulatePulse(p).echo[40]).toBe(simulatePulse(p).echo[40]);
    expect(simulatePulse({ ...p, seed: 12 }).echo[40]).not.toBe(simulatePulse(p).echo[40]);
  });
});
