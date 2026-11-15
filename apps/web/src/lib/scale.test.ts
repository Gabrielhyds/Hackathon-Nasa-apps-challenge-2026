import { describe, expect, it } from "vitest";
import { compareArea } from "./scale";

describe("compareArea", () => {
  it("diz 'do tamanho de' quando há referência próxima", () => {
    expect(compareArea(95)).toEqual({ ref: "paris", kind: "same", times: 1 });
    expect(compareArea(9800)).toEqual({ ref: "jamaica", kind: "same", times: 1 });
    expect(compareArea(3)).toEqual({ ref: "centralPark", kind: "same", times: 1 });
  });
  it("conta quantas vezes cabe a maior referência menor que a área", () => {
    expect(compareArea(410)).toEqual({ ref: "paris", kind: "times", times: 4 });
    expect(compareArea(140)).toEqual({ ref: "paris", kind: "times", times: 1.3 });
    expect(compareArea(30)).toEqual({ ref: "centralPark", kind: "times", times: 9 });
  });
  it("usa campos de futebol para áreas pequenas e arredonda números grandes", () => {
    expect(compareArea(1)).toEqual({ ref: "pitch", kind: "times", times: 140 });
  });
  it("não compara o que não dá para comparar", () => {
    expect(compareArea(0)).toBeNull();
    expect(compareArea(Number.NaN)).toBeNull();
  });
});
