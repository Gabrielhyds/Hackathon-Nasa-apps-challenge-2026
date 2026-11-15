import { describe, expect, it } from "vitest";
import { criteria, scenes } from "@nexxus/contract";
import type { Scene } from "@nexxus/contract";
import { exampleScores, hasOrigin, missingPct, passOrigins, releases, whitePoints } from "./provenance";

const base = scenes("en").find((s) => s.id === "chokwe")!;
// como a API serve a cena: com granule e versão em cada passagem e os detalhes da imagem
const served: Scene = {
  ...base,
  acquisitions: base.acquisitions.map((a, i) => ({ ...a, granule: `GRANULE_${i}`, release: i ? "provisional" : "beta" })),
  imageryDetails: { topDb: { HH: 0, HV: -6 }, validPct: 97.44 },
};

describe("origem das imagens", () => {
  it("a cena de exemplo, sem os campos da API, não tem origem para mostrar", () => {
    expect(passOrigins(base)).toEqual([]);
    expect(releases(base)).toEqual([]);
    expect(whitePoints(base)).toEqual([]);
    expect(missingPct(base)).toBeNull();
    expect(hasOrigin(base)).toBe(false);
  });
  it("lista a versão de cada passagem sem repetir, na ordem", () => {
    expect(releases(served)).toEqual(["beta", "provisional"]);
    expect(releases({ acquisitions: served.acquisitions.map((a) => ({ ...a, release: "validated" as const })) })).toEqual(["validated"]);
  });
  it("devolve granule e versão por data, e pula passagem sem granule", () => {
    expect(passOrigins(served).map((p) => [p.date, p.granule, p.release])).toEqual([["2026-01-05", "GRANULE_0", "beta"], ["2026-01-17", "GRANULE_1", "provisional"]]);
    expect(passOrigins({ acquisitions: [served.acquisitions[0], base.acquisitions[1]] }).length).toBe(1);
  });
  it("o branco de cada polarização segue a ordem das polarizações da cena", () => {
    expect(whitePoints(served)).toEqual([{ pol: "HH", db: 0 }, { pol: "HV", db: -6 }]);
    expect(whitePoints({ polarizations: ["HH"], imageryDetails: { topDb: { HH: 0, HV: -6 } } })).toEqual([{ pol: "HH", db: 0 }]);
  });
  it("só fala em parte sem dado quando falta alguma", () => {
    expect(missingPct(served)).toBe(2.6);
    expect(missingPct({ imageryDetails: { validPct: 100 } })).toBeNull();
    expect(hasOrigin(served)).toBe(true);
  });
  it("as notas do ranking de exemplo se anunciam", () => {
    expect(exampleScores(criteria("en"))).toBe(true);
    expect(exampleScores(criteria("en").map((c) => ({ ...c, isExample: false })))).toBe(false);
  });
});
