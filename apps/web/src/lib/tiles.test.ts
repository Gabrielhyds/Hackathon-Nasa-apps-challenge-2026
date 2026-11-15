import { describe, expect, it } from "vitest";
import { clearNoData, cloudDayCandidates, mayHaveNoData, packLookup } from "./tiles";

describe("packLookup: os pacotes do globo em fila", () => {
  const packs = { globe: { index: { "0/0/0": 1, "4/3/2": 1 } }, regions: { index: { "6/20/37": 1 } } };
  const setup = () => {
    const asked: string[] = [], timers: (() => void)[] = [];
    const find = packLookup(["globe", "regions"], async (name) => { asked.push(name); return packs[name as keyof typeof packs]; }, 1200, (run) => { timers.push(run); });
    return { asked, timers, find };
  };
  it("ao abrir só pede o mundo inteiro; os arredores das cenas esperam", async () => {
    const { asked, timers, find } = setup();
    expect(asked).toEqual(["globe"]);
    expect((await find("4/3/2"))?.pack).toBe(packs.globe);
    expect(asked).toEqual(["globe"]);       // achou no primeiro: o segundo nem foi pedido
    expect(timers.length).toBe(1);          // e ficou marcado para depois
    timers[0]();
    expect(asked).toEqual(["globe", "regions"]);
  });
  it("imagem que o primeiro pacote não tem puxa o segundo na hora, sem esperar o intervalo", async () => {
    const { asked, find } = setup();
    expect((await find("6/20/37"))?.pack).toBe(packs.regions);
    expect(asked).toEqual(["globe", "regions"]);
  });
  it("cada pacote é pedido uma vez só, e imagem que nenhum tem devolve nada", async () => {
    const { asked, timers, find } = setup();
    expect(await find("9/1/1")).toBeNull();
    await find("6/20/37"); await find("0/0/0");
    timers.forEach((run) => run());
    expect(asked).toEqual(["globe", "regions"]);
    expect(await packLookup([], async () => packs.globe)("0/0/0")).toBeNull();
  });
});

describe("cloudDayCandidates", () => {
  it("começa no último dia completo e recua um dia por vez", () => {
    expect(cloudDayCandidates(new Date("2026-11-15T16:30:00Z"))).toEqual(["2026-11-14", "2026-11-13", "2026-11-12"]);
  });
  it("nas primeiras horas do dia UTC, ontem ainda não está inteiro", () => {
    expect(cloudDayCandidates(new Date("2026-11-15T03:00:00Z"), 1)).toEqual(["2026-11-13"]);
    expect(cloudDayCandidates(new Date("2026-11-15T06:00:00Z"), 1)).toEqual(["2026-11-14"]);
  });
  it("pula os dias que já falharam e mantém a quantidade", () => {
    expect(cloudDayCandidates(new Date("2026-11-15T16:30:00Z"), 2, ["2026-11-14"])).toEqual(["2026-11-13", "2026-11-12"]);
  });
  it("devolve vazio para data inválida", () => {
    expect(cloudDayCandidates(new Date("ontem"))).toEqual([]);
  });
});

describe("clearNoData", () => {
  it("preto vira transparente, imagem fica inteira e a borda entra em rampa", () => {
    const px = new Uint8ClampedArray([0, 0, 0, 255, 3, 6, 2, 255, 13, 4, 4, 255, 8, 12, 40, 255, 250, 250, 250, 255]);
    clearNoData(px);
    expect([px[3], px[7], px[11], px[15], px[19]]).toEqual([0, 0, 128, 255, 255]);
    // as cores não mudam
    expect([px[12], px[13], px[14]]).toEqual([8, 12, 40]);
  });
});

describe("mayHaveNoData", () => {
  it("o mundo inteiro e os tiles que chegam perto dos polos passam pela limpeza", () => {
    expect(mayHaveNoData(0, 0)).toBe(true);
    expect(mayHaveNoData(1, 0)).toBe(true);
    expect(mayHaveNoData(3, 0)).toBe(true);
    expect(mayHaveNoData(3, 2)).toBe(true);
    expect(mayHaveNoData(3, 7)).toBe(true);
  });
  it("a faixa entre 45°S e 45°N vai direto", () => {
    expect(mayHaveNoData(3, 3)).toBe(false);
    expect(mayHaveNoData(3, 4)).toBe(false);
    // Taquari, 29,7°S, no zoom 7
    expect(mayHaveNoData(7, 75)).toBe(false);
  });
});
