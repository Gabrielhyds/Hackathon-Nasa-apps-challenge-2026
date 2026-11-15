import { describe, expect, it } from "vitest";
import { floorDb, grayToDb, meanGray, pixelUnder } from "./probe";

describe("leitura em dB sob o ponteiro", () => {
  it("desfaz a escala do gcov_crop.py: cinza = 255 · amplitude / topo", () => {
    // metade da amplitude do topo são 6 dB a menos
    expect(grayToDb(128, 0)).toEqual({ kind: "value", db: -6 });
    expect(grayToDb(128, -6)).toEqual({ kind: "value", db: -12 });
    // −12 dB em HH, o limiar de água da série do Taquari, é o cinza 64
    expect(grayToDb(Math.round(255 * 10 ** (-12 / 20)), 0)).toEqual({ kind: "value", db: -12 });
  });
  it("as pontas da escala não viram número exato", () => {
    expect(grayToDb(255, -6)).toEqual({ kind: "top", db: -6 });
    expect(grayToDb(0, 0).kind).toBe("floor");
    expect(floorDb(0)).toBeCloseTo(-54.15, 1);
    expect(grayToDb(1, 0).kind).toBe("value");
  });
  it("acha o pixel sob um ponto e devolve nada fora do recorte", () => {
    const bbox = [-52, -30, -51, -29] as const;
    expect(pixelUnder(bbox, -52, -29, 512)).toEqual({ x: 0, y: 0 });
    expect(pixelUnder(bbox, -51, -30, 512)).toEqual({ x: 511, y: 511 });
    expect(pixelUnder(bbox, -51.5, -29.5, 512)!.x).toBe(256);
    expect(pixelUnder(bbox, -50.9, -29.5, 512)).toBeNull();
    expect(pixelUnder(bbox, -51.5, -28.9, 512)).toBeNull();
  });
  it("em latitude alta a linha segue a projeção do mapa, não a latitude em linha reta", () => {
    const y = pixelUnder([-51, 68, -49, 70], -50, 69, 512)!.y;
    expect(y).toBeGreaterThan(256); // o meio em latitude fica abaixo do meio da imagem desenhada
    expect(y).toBeLessThan(275);
  });
  it("faz a média em volta do pixel, sem sair da imagem", () => {
    const g = Uint8Array.from([10, 20, 30, 40, 50, 60, 70, 80, 90]);
    expect(meanGray(g, 3, 1, 1)).toBe(50);
    expect(meanGray(g, 3, 0, 0)).toBe(30); // (10 + 20 + 40 + 50) / 4
    expect(meanGray(g, 3, 1, 1, 0)).toBe(50);
  });
});
