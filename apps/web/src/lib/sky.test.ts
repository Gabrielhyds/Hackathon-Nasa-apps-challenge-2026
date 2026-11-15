import { describe, expect, it } from "vitest";
import { cameraBasis, galacticToEquatorial, globeView, gmstDeg, projectSky, starColor, unit } from "./sky";

describe("sky", () => {
  it("dá o tempo sideral de Greenwich em J2000", () => {
    expect(gmstDeg(new Date("2000-01-01T12:00:00Z"))).toBeCloseTo(280.4606, 3);
  });
  it("leva o centro galáctico a Sagitário", () => {
    const [ra, dec] = galacticToEquatorial(0, 0);
    expect(ra).toBeCloseTo(266.405, 2);
    expect(dec).toBeCloseTo(-28.936, 2);
  });
  it("projeta no centro da tela a direção oposta à câmera, com o leste à direita e o norte em cima", () => {
    const basis = cameraBasis(10, 40);
    expect(projectSky(unit(220, -10), basis, 1000)).toEqual([expect.closeTo(0, 6), expect.closeTo(0, 6)]);
    expect(projectSky(unit(40, 10), basis, 1000)).toBeNull();
    // atrás da Terra, quem está a leste do centro (ascensão reta menor que a do ponto oposto) cai à direita
    expect(projectSky(unit(215, -10), basis, 1000)![0]).toBeGreaterThan(0);
    expect(projectSky(unit(220, 0), basis, 1000)![1]).toBeLessThan(0);
  });
  it("mede o globo como o MapLibre: o diâmetro é a largura do mundo sobre pi, no equador", () => {
    const view = globeView(1, 0, 800);
    expect(view.radius).toBeCloseTo(1024 / (2 * Math.PI), 6);
    expect(view.limb).toBeLessThan(view.radius);
    expect(globeView(1, 60, 800).radius).toBeCloseTo(2 * view.radius, 6);
  });
  it("pinta estrela quente de azulado e fria de alaranjado", () => {
    const hot = starColor(-0.2), cool = starColor(1.6);
    expect(hot[2]).toBeGreaterThan(hot[0]);
    expect(cool[0]).toBeGreaterThan(cool[2]);
    expect(starColor(9)).toEqual(starColor(2));
  });
});
