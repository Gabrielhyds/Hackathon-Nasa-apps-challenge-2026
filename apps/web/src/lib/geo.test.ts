import { describe, expect, it } from "vitest";
import { distanceKm, NISAR, swath } from "./geo";

describe("swath", () => {
  const here: [number, number] = [-47, -23];
  it("completa, passa pelo lugar e tem a largura da faixa do NISAR", () => {
    const s = swath(here, "ascending", 2800);
    const mid = s.line[Math.floor(s.line.length / 2)];
    expect(distanceKm(mid, here)).toBeLessThan(1);
    expect(distanceKm(s.line[0], s.line[s.line.length - 1])).toBeGreaterThan(2700);
    const half = (s.ring.length - 1) / 2;
    expect(distanceKm(s.ring[0], s.ring[s.ring.length - 2])).toBeCloseTo(NISAR.swathKm, 0);
    expect(half).toBe(s.line.length);
  });
  it("cresce com o alcance e fecha o anel", () => {
    const short = swath(here, "descending", 400), full = swath(here, "descending", 2800);
    expect(short.line.length).toBeLessThan(full.line.length);
    expect(short.ring[0]).toEqual(short.ring[short.ring.length - 1]);
  });
});
