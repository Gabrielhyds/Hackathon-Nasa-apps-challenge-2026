import { describe, expect, it } from "vitest";
import { fringeReading, paintPhase, parseLut, readTransect } from "./fringes";

/** Imagem de fase com `fringes` voltas da esquerda para a direita. */
function ramp(width: number, height: number, fringes: number): Uint8Array {
  const out = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const turn = ((x / (width - 1)) * fringes) % 1;
    out[y * width + x] = 1 + Math.min(254, Math.floor(turn * 255));
  }
  return out;
}

describe("régua de franjas", () => {
  it("conta as franjas ao longo da linha, sem converter em centímetros", () => {
    const w = 400, h = 40, phase = ramp(w, h, 5);
    const t = readTransect(phase, w, h, { x: 0, y: 20 }, { x: w - 1, y: 20 });
    const r = fringeReading(t);
    expect(r.fringes).toBeCloseTo(5, 0);
    expect(Object.keys(r).sort()).toEqual(["fringes", "reliable", "solid"]);
    expect(r.reliable).toBe(true);
  });
  it("ao longo de uma franja (fase constante) não mede nada", () => {
    const w = 200, h = 200, phase = ramp(w, h, 4);
    const r = fringeReading(readTransect(phase, w, h, { x: 60, y: 10 }, { x: 60, y: 190 }));
    expect(r.fringes).toBeLessThan(0.05);
  });
  it("ida e volta dão o mesmo valor", () => {
    const w = 300, h = 30, phase = ramp(w, h, 3);
    const a = fringeReading(readTransect(phase, w, h, { x: 20, y: 15 }, { x: 250, y: 15 }));
    const b = fringeReading(readTransect(phase, w, h, { x: 250, y: 15 }, { x: 20, y: 15 }));
    expect(a.fringes).toBeCloseTo(b.fringes, 5);
  });
  it("avisa quando a linha cruza ruído", () => {
    const w = 200, h = 20, phase = new Uint8Array(w * h);
    let seed = 1;
    for (let i = 0; i < phase.length; i++) { seed = (seed * 1103515245 + 12345) & 0x7fffffff; phase[i] = 1 + (seed % 255); }
    const r = fringeReading(readTransect(phase, w, h, { x: 0, y: 10 }, { x: 199, y: 10 }));
    expect(r.reliable).toBe(false);
  });
  it("começa a contar na primeira amostra com dado e não anda onde falta dado", () => {
    const w = 400, h = 40, phase = ramp(w, h, 5);
    // sem dado no começo, no meio e no fim da linha
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (x < 60 || (x >= 200 && x < 215) || x >= 340) phase[y * w + x] = 0;
    const t = readTransect(phase, w, h, { x: 0, y: 20 }, { x: w - 1, y: 20 });
    expect(t.cycles[50]).toBe(0);
    expect(t.cycles[210]).toBe(t.cycles[203]);
    expect(t.cycles[w - 1]).toBe(t.cycles[345]);
    // o trecho com dado vai de x = 60 a x = 339: perto de 280/399 de 5 voltas, e o buraco do meio não muda a conta
    const total = Math.abs(t.cycles[w - 1]);
    expect(total).toBeGreaterThan(3.35);
    expect(total).toBeLessThan(3.65);
  });
  it("pinta com a tabela de cores e escurece onde não há dado", () => {
    const lut = parseLut(["ff0000", "00ff00"]), out = new Uint8ClampedArray(8);
    paintPhase(new Uint8Array([0, 255]), lut, out);
    expect([...out.slice(4)]).toEqual([0, 255, 0, 255]);
    expect(out[0]).toBeLessThan(20);
  });
});
