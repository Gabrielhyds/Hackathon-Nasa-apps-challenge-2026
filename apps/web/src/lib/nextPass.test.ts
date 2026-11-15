import { describe, expect, it } from "vitest";
import type { Pass } from "@nexxus/contract";
import { nextPasses } from "./nextPass";

const pass = (date: string, direction: Pass["direction"]): Pass => ({ date, direction, track: 1, frame: 1, polarization: "HH", product: "GCOV" });
const NOW = Date.UTC(2026, 10, 14, 15); // 14 nov 2026, à tarde

describe("nextPasses", () => {
  it("soma 12 dias à última passagem de cada órbita, a mais próxima primeiro", () => {
    const list = [pass("2026-11-10", "ascending"), pass("2026-10-29", "ascending"), pass("2026-11-05", "descending")];
    expect(nextPasses(list, NOW)).toEqual([
      { direction: "descending", date: "2026-11-17", inDays: 3 },
      { direction: "ascending", date: "2026-11-22", inDays: 8 },
    ]);
  });
  it("pula ciclos quando a última passagem conhecida é antiga", () => {
    expect(nextPasses([pass("2026-09-03", "ascending")], NOW)).toEqual([{ direction: "ascending", date: "2026-11-14", inDays: 0 }]);
  });
  it("uma passagem de hoje conta como a próxima", () => {
    expect(nextPasses([pass("2026-11-14", "descending")], NOW)[0].inDays).toBe(0);
  });
  it("sem passagens não estima nada", () => {
    expect(nextPasses([], NOW)).toEqual([]);
  });
});
