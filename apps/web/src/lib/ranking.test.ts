import { describe, expect, it } from "vitest";
import { criteria, mockAsk, mockPasses, scenes, searchPlaces } from "@nexxus/contract";

const CRITERIA = criteria("en");
const SCENES = scenes("en");
import { defaultWeights, eventsFirst, rank } from "./ranking";

describe("rank", () => {
  it("ordena pela média quando os pesos são iguais", () => {
    const r = rank(SCENES, CRITERIA, defaultWeights(CRITERIA));
    expect(r[0].scene.id).toBe("taquari");
    expect(r[0].total).toBeCloseTo(80);
    expect(r[0].parts.reduce((a, b) => a + b, 0)).toBeCloseTo(r[0].total);
  });
  it("muda a ordem quando um critério passa a valer sozinho", () => {
    const w = { magnitude: 0, area: 0, clarity: 0, passes: 5 };
    expect(rank(SCENES, CRITERIA, w)[0].scene.id).toBe("maceio");
  });
  it("na tela, as cenas com evento documentado vêm antes das sazonais, cada grupo na ordem da nota", () => {
    const ranked = rank(SCENES, CRITERIA, defaultWeights(CRITERIA)), { events, others } = eventsFirst(ranked);
    expect(events.map((r) => r.scene.id)).toEqual(["taquari", "chokwe"]);
    expect(others.length).toBe(SCENES.length - 2);
    expect(others.every((r) => r.scene.basis === "interpretation")).toBe(true);
    expect(others.map((r) => r.total)).toEqual([...others.map((r) => r.total)].sort((a, b) => b - a));
    // mesmo com pesos que jogam um evento para o fim da nota, ele continua na frente
    expect(eventsFirst(rank(SCENES, CRITERIA, { magnitude: 0, area: 0, clarity: 0, passes: 5 })).events.length).toBe(2);
  });
  it("devolve zero com todos os pesos zerados", () => {
    const w = { magnitude: 0, area: 0, clarity: 0, passes: 0 };
    expect(rank(SCENES, CRITERIA, w).every((x) => x.total === 0)).toBe(true);
  });
});

describe("dados de exemplo", () => {
  it("gera passagens da mais recente para a mais antiga, com as duas órbitas", () => {
    const p = mockPasses(-22.9, -47.1, Date.UTC(2026, 10, 12));
    expect(p).toHaveLength(10);
    expect([...p].sort((a, b) => b.date.localeCompare(a.date))).toEqual(p);
    expect(new Set(p.map((x) => x.direction)).size).toBe(2);
  });
  it("acha lugar sem acento e em qualquer idioma", () => {
    expect(searchPlaces("sao pau", { kind: "city", lang: "pt" })[0].name).toBe("São Paulo");
    expect(searchPlaces("alemanha", { lang: "en" })[0]).toMatchObject({ kind: "country", name: "Germany" });
    expect(searchPlaces("germany", { lang: "pt" })[0].name).toBe("Alemanha");
  });
  it("filtra por tipo de lugar", () => {
    expect(searchPlaces("par", { kind: "state" }).every((p) => p.kind === "state")).toBe(true);
    expect(searchPlaces("bra", { kind: "country" })[0].name).toBe("Brazil");
  });
  it("afunila de país para estado e cidade", () => {
    const states = searchPlaces("", { countryCode: "BR", kind: "state", lang: "pt" });
    expect(states).toHaveLength(27);
    expect(states[0].name).toBe("Acre");
    const sp = searchPlaces("sao paulo", { countryCode: "BR", kind: "state" })[0];
    const cities = searchPlaces("", { countryCode: "BR", adminKey: sp.adminKey });
    expect(cities[0].name).toBe("São Paulo");
    expect(cities.every((c) => c.kind === "city" && c.adminKey === sp.adminKey)).toBe(true);
    expect(searchPlaces("camp", { countryCode: "BR", adminKey: sp.adminKey }).map((c) => c.name)).toContain("Campinas");
    expect(searchPlaces("paris", { countryCode: "BR" })).toHaveLength(0);
  });
  it("traduz cenas e resposta de exemplo", () => {
    const pt = (id: string) => scenes("pt").find((s) => s.id === id)!;
    const en = (id: string) => scenes("en").find((s) => s.id === id)!;
    expect(pt("sindh").event).toBe("Mudança sazonal");
    expect(en("sindh").event).toBe("Seasonal change");
    // evento confirmado, com fonte: o nome do evento no lugar de "Mudança sazonal" e a data no lugar da estação
    expect(pt("taquari").event).toBe("Enchente");
    expect(en("taquari").facts[0]).toEqual({ label: "Event", value: "River flood, July 22, 2026" });
    expect(scenes("pt")[0].facts[1].value).toBe("Trilha 53, descendente");
    expect(mockAsk({ question: "?", sceneIds: ["taquari"], lang: "pt" }).answer).toContain("Vale do Taquari");
  });
});
