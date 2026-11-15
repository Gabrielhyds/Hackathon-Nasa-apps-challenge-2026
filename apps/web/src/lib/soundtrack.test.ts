import { describe, expect, it } from "vitest";
import { dataUrlBytes, trackFor, type Screen } from "./soundtrack";

const base: Screen = { intro: false, tab: "scenes", audience: "explore", lab: null, opened: false, view: "swipe" };

describe("trackFor", () => {
  it("toca a faixa de explorar no globo, na abertura e na história da cena", () => {
    expect(trackFor(base)).toBe("explore");
    expect(trackFor({ ...base, intro: true, audience: "analyze" })).toBe("explore");
    expect(trackFor({ ...base, opened: true })).toBe("explore");
    expect(trackFor({ ...base, opened: true, view: "optical" })).toBe("explore");
  });
  it("toca a faixa de dados no nível Dados, no laboratório e no mapa de mudança", () => {
    expect(trackFor({ ...base, audience: "analyze" })).toBe("data");
    expect(trackFor({ ...base, lab: "pulse" })).toBe("data");
    expect(trackFor({ ...base, tab: "ask", lab: "hydro" })).toBe("data");
    expect(trackFor({ ...base, opened: true, view: "change" })).toBe("data");
  });
  it("volta à de explorar na conversa e no lugar, mesmo no nível Dados", () => {
    expect(trackFor({ ...base, tab: "ask", audience: "analyze" })).toBe("explore");
    expect(trackFor({ ...base, tab: "passes", audience: "analyze", opened: true, view: "change" })).toBe("explore");
  });
  it("não conta o mapa de mudança lembrado quando nenhuma cena está aberta", () => {
    expect(trackFor({ ...base, view: "change" })).toBe("explore");
  });
});

describe("dataUrlBytes", () => {
  it("lê os bytes de um endereço data em base64", () => {
    expect([...dataUrlBytes("data:audio/mpeg;base64,AAEC/w==")!]).toEqual([0, 1, 2, 255]);
  });
  it("devolve null para endereço comum", () => {
    expect(dataUrlBytes("./assets/exploration-theme.mp3")).toBeNull();
  });
});
