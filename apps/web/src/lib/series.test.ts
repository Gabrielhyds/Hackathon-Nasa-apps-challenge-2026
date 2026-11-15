import { describe, expect, it } from "vitest";
import { scenes } from "@nexxus/contract";
import { clampSteps, fullRange, growth, isInterferogram, moveStep, pairs, polarizationFor, walk, daysBetween, pickStep } from "./series";

describe("cena de interferograma", () => {
  const all = scenes("en", ["interferogram"]), quake = all.find((s) => s.id === "laguaira")!;
  it("só a cena de fase conta como interferograma", () => {
    expect(all.filter(isInterferogram).map((s) => s.id)).toEqual(["laguaira"]);
    expect(scenes("en").some(isInterferogram)).toBe(false);
  });
  it("cada item da série é um par, do primeiro ao segundo, e os dois se encostam na passagem de 18/06", () => {
    expect(pairs(quake)).toEqual([{ from: "2026-06-06", to: "2026-06-18" }, { from: "2026-06-18", to: "2026-06-30" }]);
    expect(pairs(all[0])).toEqual([]);
  });
});

describe("série de passagens", () => {
  it("abre comparando a primeira com a última", () => {
    expect(fullRange(6)).toEqual([0, 5]);
    expect(fullRange(2)).toEqual([0, 1]);
  });

  it("mantém o par dentro da série e com antes < depois", () => {
    expect(clampSteps([3, 9], 6)).toEqual([3, 5]);
    expect(clampSteps([4, 4], 6)).toEqual([3, 4]);
    expect(clampSteps([-2, 0], 6)).toEqual([0, 1]);
  });

  it("um extremo não cruza o outro", () => {
    expect(moveStep([1, 3], "from", 5, 6)).toEqual([2, 3]);
    expect(moveStep([1, 3], "to", 0, 6)).toEqual([1, 2]);
    expect(moveStep([1, 3], "to", 5, 6)).toEqual([1, 5]);
  });

  it("a animação anda uma passagem por vez", () => {
    expect(walk([0, 3])).toEqual([[0, 1], [1, 2], [2, 3]]);
    expect(walk([2, 3])).toEqual([[2, 3]]);
  });

  it("cai para a polarização que a cena tem", () => {
    expect(polarizationFor({ polarizations: ["HH", "HV"] }, "HV")).toBe("HV");
    expect(polarizationFor({ polarizations: ["HH"] }, "HV")).toBe("HH");
  });

  it("a mudança do exemplo cresce até a última passagem", () => {
    expect(growth(0, 6)).toBe(0);
    expect(growth(1, 6)).toBeGreaterThan(0);
    expect(growth(3, 6)).toBeGreaterThan(growth(1, 6));
    expect(growth(5, 6)).toBe(1);
  });
});

describe("régua de passagens", () => {
  it("a passagem escolhida vira o extremo mais próximo do par", () => {
    expect(pickStep([1, 3], 0, 5)).toEqual([0, 3]);
    expect(pickStep([1, 3], 4, 5)).toEqual([1, 4]);
    expect(pickStep([0, 4], 1, 5)).toEqual([1, 4]);
    expect(pickStep([0, 4], 3, 5)).toEqual([0, 3]);
    expect(pickStep([0, 4], 2, 5)).toEqual([2, 4]);
    expect(pickStep([0, 4], 4, 5)).toEqual([0, 4]);
  });
  it("conta os dias entre duas passagens", () => {
    expect(daysBetween("2026-06-17", "2026-10-27")).toBe(132);
  });
});
