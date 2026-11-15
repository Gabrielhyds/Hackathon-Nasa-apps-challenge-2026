import { describe, expect, it } from "vitest";
import { scenes } from "@nexxus/contract";
import { cloudTimeCandidates, inGoesEastView, packLookup } from "./tiles";

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

describe("inGoesEastView", () => {
  it("as cenas das Américas têm nuvens de agora; as de fora, não", () => {
    const lon = (id: string) => scenes("en").find((s) => s.id === id)!.lon;
    for (const id of ["taquari", "campinas", "maceio", "labrea", "pantanal"]) expect(inGoesEastView(lon(id))).toBe(true);
    for (const id of ["chokwe", "sindh", "kalimantan"]) expect(inGoesEastView(lon(id))).toBe(false);
  });
  it("inclui as pontas da faixa e aceita longitude de 0 a 360", () => {
    expect(inGoesEastView(-125)).toBe(true);
    expect(inGoesEastView(-20)).toBe(true);
    expect(inGoesEastView(-126)).toBe(false);
    expect(inGoesEastView(308)).toBe(true);
    expect(inGoesEastView(68.5)).toBe(false);
  });
});

describe("cloudTimeCandidates", () => {
  it("recua de 10 em 10 minutos a partir da hora anunciada", () => {
    expect(cloudTimeCandidates("2026-11-14T23:40:00Z", 3)).toEqual(["2026-11-14T23:40:00Z", "2026-11-14T23:30:00Z", "2026-11-14T23:20:00Z"]);
  });
  it("pula as horas que já falharam e mantém a quantidade", () => {
    expect(cloudTimeCandidates("2026-11-15T00:00:00Z", 2, ["2026-11-15T00:00:00Z"])).toEqual(["2026-11-14T23:50:00Z", "2026-11-14T23:40:00Z"]);
  });
  it("devolve vazio para hora inválida", () => {
    expect(cloudTimeCandidates("ontem")).toEqual([]);
  });
});
