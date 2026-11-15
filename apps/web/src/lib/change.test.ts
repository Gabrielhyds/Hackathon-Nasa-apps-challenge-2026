import { describe, expect, it } from "vitest";
import { DEFAULT_SENSITIVITY, boxBlur, changeMap, changedFraction, changedParts, median, ratioFor } from "./change";
import { bboxAreaKm2 } from "./geo";

const S = 32;
/** Imagem com ruído granulado e, opcionalmente, um quadrado central de 16 × 16 com outro brilho. */
function image(seed: number, factor = 1): Float32Array {
  let s = seed;
  const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
  return Float32Array.from({ length: S * S }, (_, i) => {
    const x = i % S, y = Math.floor(i / S), inside = x >= 8 && x < 24 && y >= 8 && y < 24;
    return 0.5 * (inside ? factor : 1) * -Math.log(1 - rnd() * 0.98);
  });
}

describe("mapa de mudança", () => {
  it("a suavização preserva a média", () => {
    const flat = new Float32Array(S * S).fill(0.4);
    expect(boxBlur(flat, S, 3).every((v) => Math.abs(v - 0.4) < 1e-6)).toBe(true);
  });
  it("quase não acusa mudança entre duas passagens que só diferem no ruído", () => {
    expect(changedFraction(changeMap(image(1), image(2), S, 3), ratioFor(0))).toBeLessThan(0.04);
  });
  it("acha a área que escureceu, perto do tamanho real", () => {
    const fraction = changedFraction(changeMap(image(1), image(2, 0.18), S, 3), ratioFor(0));
    expect(fraction).toBeGreaterThan(0.15);
    expect(fraction).toBeLessThan(0.35); // o quadrado ocupa 25% da imagem
  });
  it("imagem inteira mais clara (contraste esticado em outra data) não conta como mudança", () => {
    const brighter = image(1).map((v) => v * 1.6);
    expect(changedFraction(changeMap(image(1), brighter, S, 3), ratioFor(DEFAULT_SENSITIVITY))).toBeLessThan(0.01);
  });
  it("o ajuste de brilho não apaga uma mudança grande", () => {
    // quadrado que escurece cobre 25% da imagem; a outra passagem também veio 1,6× mais clara
    const after = image(1, 0.18).map((v) => v * 1.6);
    const fraction = changedFraction(changeMap(image(1), after, S, 3), ratioFor(DEFAULT_SENSITIVITY));
    expect(fraction).toBeGreaterThan(0.15);
    expect(fraction).toBeLessThan(0.35);
  });
  it("separa o que escureceu do que clareou", () => {
    const darker = changedParts(changeMap(image(1), image(2, 0.18), S, 3), ratioFor(0));
    expect(darker.down).toBeGreaterThan(0.15);
    expect(darker.up).toBeLessThan(0.02);
    const brighter = changedParts(changeMap(image(1), image(2, 4), S, 3), ratioFor(0));
    expect(brighter.up).toBeGreaterThan(0.15);
    expect(brighter.down).toBeLessThan(0.02);
    expect(darker.down + darker.up).toBeCloseTo(changedFraction(changeMap(image(1), image(2, 0.18), S, 3), ratioFor(0)), 6);
  });
  it("no dado calibrado a mediana não é descontada: a cena inteira mais clara conta como subida", () => {
    const brighter = image(1).map((v) => v * 1.6);
    const parts = changedParts(changeMap(image(1), brighter, S, 3, true), ratioFor(DEFAULT_SENSITIVITY));
    expect(parts.up).toBeGreaterThan(0.95);
    expect(parts.down).toBe(0);
  });
  it("no dado calibrado, o fundo que clareia não vira queda no que ficou igual", () => {
    // três quartos da imagem clareiam 1,6× (solo molhado) e o quadrado central fica como estava
    const after = image(1).map((v, i) => { const x = i % S, y = Math.floor(i / S); return x >= 8 && x < 24 && y >= 8 && y < 24 ? v : v * 1.6; });
    const calibrated = changedParts(changeMap(image(1), after, S, 3, true), ratioFor(DEFAULT_SENSITIVITY));
    const relative = changedParts(changeMap(image(1), after, S, 3), ratioFor(DEFAULT_SENSITIVITY));
    expect(calibrated.down).toBeLessThan(0.01);
    expect(calibrated.up).toBeGreaterThan(0.55);
    expect(relative.down).toBeGreaterThan(0.1); // com a mediana descontada, o que não mudou aparece como queda
  });
  it("abre em 1,25× e vai de 2× a 1,1×", () => {
    expect(ratioFor(DEFAULT_SENSITIVITY)).toBeCloseTo(1.25, 5);
    expect(ratioFor(0)).toBeCloseTo(2, 5);
    expect(ratioFor(1)).toBeCloseTo(1.1, 5);
  });
  it("mediana", () => {
    expect(median(Float32Array.from([3, 1, 2]))).toBe(2);
    expect(median(Float32Array.from([4, 1, 3, 2]))).toBe(2.5);
  });
  it("mais sensibilidade nunca diminui a área", () => {
    const map = changeMap(image(1), image(2, 0.5), S, 3);
    expect(changedFraction(map, ratioFor(0.9))).toBeGreaterThanOrEqual(changedFraction(map, ratioFor(0.2)));
    expect(ratioFor(0)).toBeGreaterThan(ratioFor(1));
  });
});

describe("bboxAreaKm2", () => {
  it("um grau por um grau no equador tem cerca de 12 mil km²", () => {
    expect(bboxAreaKm2([0, -0.5, 1, 0.5])).toBeGreaterThan(12300);
    expect(bboxAreaKm2([0, -0.5, 1, 0.5])).toBeLessThan(12400);
  });
  it("encolhe em latitude alta", () => {
    expect(bboxAreaKm2([0, 59.5, 1, 60.5])).toBeLessThan(bboxAreaKm2([0, -0.5, 1, 0.5]) * 0.52);
  });
});
