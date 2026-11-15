import { describe, expect, it } from "vitest";
import { buildUrlState, parseUrlState, type UrlState } from "./urlState";

describe("estado no endereço", () => {
  it("vai e volta sem perder nada", () => {
    const state: UrlState = {
      scene: "labrea", tab: "ask", view: "change", pol: "HV", steps: [1, 4], compare: ["labrea", "sindh"], lang: "pt",
      place: { kind: "country", name: "Brasil", lat: -12.1, lon: -49.56, spanDeg: 39.2 },
    };
    expect(parseUrlState(buildUrlState(state))).toEqual(state);
  });
  it("guarda o público, menos o padrão", () => {
    expect(buildUrlState({ aud: "analyze" })).toBe("?aud=analyze");
    expect(buildUrlState({ aud: "explore" })).toBe("");
    expect(parseUrlState("?aud=analyze")).toEqual({ aud: "analyze" });
    expect(parseUrlState("?aud=todos")).toEqual({});
    // o nível Aula saiu: link antigo cai no Simples
    expect(parseUrlState("?aud=teach")).toEqual({});
  });
  it("guarda o painel do laboratório aberto", () => {
    expect(buildUrlState({ lab: "fringes" })).toBe("?lab=fringes");
    expect(parseUrlState("?lab=hydro&scene=taquari")).toEqual({ lab: "hydro", scene: "taquari" });
    expect(parseUrlState("?lab=nada")).toEqual({});
  });
  it("guarda o pedido do painel de desempenho", () => {
    expect(buildUrlState({ perf: true, scene: "sindh" })).toBe("?scene=sindh&perf=1");
    expect(parseUrlState("?perf=1")).toEqual({ perf: true });
    expect(parseUrlState("?perf=sim")).toEqual({});
  });
  it("deixa o endereço limpo quando tudo está no padrão", () => {
    expect(buildUrlState({})).toBe("");
    expect(buildUrlState({ tab: "scenes", view: "swipe", pol: "HH" })).toBe("");
  });
  it("preserva parâmetros que não são nossos", () => {
    expect(buildUrlState({ scene: "sindh" }, "?__frame_v=abc&scene=labrea&tab=ask")).toBe("?__frame_v=abc&scene=sindh");
    expect(buildUrlState({}, "?__frame_v=abc&lang=pt")).toBe("?__frame_v=abc");
  });
  it("guarda o modo óptico como guarda o mapa de mudança", () => {
    expect(parseUrlState("?scene=taquari&view=optical")).toEqual({ scene: "taquari", view: "optical" });
    expect(buildUrlState({ scene: "taquari", view: "optical" })).toBe("?scene=taquari&view=optical");
  });
  it("ignora valores inválidos em vez de quebrar", () => {
    expect(parseUrlState("?tab=nada&view=x&lang=fr&place=abc,200,X")).toEqual({});
    expect(parseUrlState("?place=95,10,X")).toEqual({});
    expect(parseUrlState("?pol=VV&steps=3,1")).toEqual({});
    expect(parseUrlState("?steps=a,2")).toEqual({});
  });
  it("lê um ponto simples e tira vírgula do nome", () => {
    expect(parseUrlState("?place=-22.9,-47.1,Campinas").place).toEqual({ kind: "city", name: "Campinas", lat: -22.9, lon: -47.1 });
    const url = buildUrlState({ place: { kind: "city", name: "Campinas, São Paulo", lat: -22.9, lon: -47.1 } });
    expect(parseUrlState(url).place?.name).toBe("Campinas  São Paulo");
  });
  it("distingue lista de comparação vazia de ausente", () => {
    expect(parseUrlState("?compare=").compare).toEqual([]);
    expect(parseUrlState("").compare).toBeUndefined();
  });
});
