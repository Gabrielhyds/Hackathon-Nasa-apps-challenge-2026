import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { scenes } from "@nexxus/contract";
import { corners, coversScene, hasOptical, opticalFrame, opticalImage, opticalKey } from "./optical";

const all = scenes("en", ["interferogram"]);
const withOptical = all.filter((s) => s.opticalDay);

describe("imagem óptica do dia do evento", () => {
  it("o Taquari tem uma, e a legenda vem nos dois idiomas", () => {
    expect(withOptical.map((s) => s.id)).toContain("taquari");
    const pt = scenes("pt").find((s) => s.id === "taquari")!.opticalDay!, en = withOptical.find((s) => s.id === "taquari")!.opticalDay!;
    expect(pt.caption).not.toBe(en.caption);
    expect(pt.date).toBe(en.date);
  });
  it("toda cena com o campo tem o arquivo gravado pelo script, e a região contém a cena", () => {
    for (const s of withOptical) {
      expect(existsSync(resolve(__dirname, `../assets/optical/${opticalKey(s)}.webp`)), s.id).toBe(true);
      expect(opticalImage(s), s.id).not.toBeNull();
      expect(coversScene(s), s.id).toBe(true);
      expect(hasOptical(s), s.id).toBe(true);
    }
  });
  it("cena sem o campo não tem imagem nem enquadramento", () => {
    const plain = all.find((s) => !s.opticalDay)!;
    expect(opticalKey(plain)).toBeNull();
    expect(hasOptical(plain)).toBe(false);
    expect(opticalFrame(plain)).toBeNull();
  });
  it("região que não contém a cena não serve", () => {
    const s = { id: "x", bbox: [0, 0, 1, 1] as [number, number, number, number], opticalDay: { date: "2026-01-01", bbox: [0.5, -1, 2, 2] as [number, number, number, number], sensor: "", credit: "", caption: "" } };
    expect(coversScene(s)).toBe(false);
    expect(opticalFrame(s)).toBeNull();
  });
  it("enquadra a cena no centro, ampliada, sem sair da região da imagem", () => {
    const day = { date: "2026-01-01", sensor: "", credit: "", caption: "" };
    expect(opticalFrame({ bbox: [10, 10, 12, 11], opticalDay: { ...day, bbox: [0, 0, 20, 20] } }, 3)).toEqual([8, 9, 14, 12]);
    expect(opticalFrame({ bbox: [10, 10, 12, 11], opticalDay: { ...day, bbox: [9, 9.5, 20, 20] } }, 3)).toEqual([9, 9.5, 14, 12]);
  });
  it("devolve os cantos na ordem do mapa", () => {
    expect(corners([1, 2, 3, 4])).toEqual([[1, 4], [3, 4], [3, 2], [1, 2]]);
  });
});
