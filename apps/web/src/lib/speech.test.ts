import { describe, expect, it } from "vitest";
import { pickVoice, speakable, speechChunks, spokenAnswer } from "./speech";

describe("speakable", () => {
  it("escreve as unidades por extenso, no idioma da resposta", () => {
    expect(speakable("Cerca de 53 km² (faixa de 49 a 56 km²).", "pt")).toBe("Cerca de 53 quilômetros quadrados (faixa de 49 a 56 quilômetros quadrados).");
    expect(speakable("About 53 km² of new open water.", "en")).toBe("About 53 square kilometers of new open water.");
    expect(speakable("O rio chegou a 24,7 m em Lajeado.", "pt")).toBe("O rio chegou a 24,7 metros em Lajeado.");
    expect(speakable("Each strip is about 240 km wide; one cycle is 12 cm.", "en")).toBe("Each strip is about 240 kilometers wide; one cycle is 12 centimeters.");
    expect(speakable("Banda de 40 MHz.", "pt")).toBe("Banda de 40 megahertz.");
  });

  it("usa o singular quando o número é 1", () => {
    expect(speakable("Cerca de 1 km² nas semanas anteriores.", "pt")).toBe("Cerca de 1 quilômetro quadrado nas semanas anteriores.");
    expect(speakable("From 0.3 to 1.6 km².", "en")).toBe("From 0.3 to 1.6 square kilometers.");
  });

  it("lê o sinal de menos e o × da sensibilidade", () => {
    expect(speakable("Abaixo de −12 dB (faixa: −14 a −10 dB).", "pt")).toBe("Abaixo de menos 12 decibéis (faixa: menos 14 a menos 10 decibéis).");
    expect(speakable("A 3 dB drop, below −12 dB, at 1.25× sensitivity.", "en")).toBe("A 3 decibels drop, below minus 12 decibels, at 1.25 times sensitivity.");
  });

  it("não mexe em datas, intervalos com hífen nem em palavras que começam com a unidade", () => {
    expect(speakable("De 17/06 a 23/07/2026, 4-8 dias, 6 meses, 3 mapas.", "pt")).toBe("De 17/06 a 23/07/2026, 4-8 dias, 6 meses, 3 mapas.");
    expect(speakable("Magnitude M 7,2 e 30 mil casas.", "pt")).toBe("Magnitude M 7,2 e 30 mil casas.");
  });

  it("junta quebras de linha e espaços repetidos", () => {
    expect(speakable("Uma  linha.\nOutra.", "pt")).toBe("Uma linha. Outra.");
  });
});

describe("speechChunks", () => {
  it("parte por frase e não corta número decimal", () => {
    expect(speechChunks("From 0.3 to 1.6 km². Four days later, 5 km²! Is that all? Yes."))
      .toEqual(["From 0.3 to 1.6 km².", "Four days later, 5 km²!", "Is that all?", "Yes."]);
  });

  it("quebra frase longa na vírgula e, sem vírgula, no espaço", () => {
    const long = "Primeira parte da frase, segunda parte da frase, terceira parte da frase.";
    expect(speechChunks(long, 30)).toEqual(["Primeira parte da frase,", "segunda parte da frase,", "terceira parte da frase."]);
    const chunks = speechChunks("uma palavra depois da outra sem nenhuma pausa no meio do caminho", 20);
    expect(chunks.every((c) => c.length <= 20)).toBe(true);
    expect(chunks.join(" ")).toBe("uma palavra depois da outra sem nenhuma pausa no meio do caminho");
  });

  it("devolve lista vazia para texto vazio", () => {
    expect(speechChunks("  \n ")).toEqual([]);
  });
});

describe("pickVoice", () => {
  const voices = [
    { name: "US", lang: "en-US" }, { name: "UK", lang: "en-GB" }, { name: "PT", lang: "pt-PT" },
    { name: "BR", lang: "pt-BR" }, { name: "BR padrão", lang: "pt_BR", default: true }, { name: "ES", lang: "es-ES" },
  ];

  it("prefere a voz do país certo e, entre iguais, a padrão do sistema", () => {
    expect(pickVoice(voices, "pt")?.name).toBe("BR padrão");
    expect(pickVoice(voices, "en")?.name).toBe("US");
  });

  it("aceita outra voz do mesmo idioma quando não há a do país", () => {
    expect(pickVoice(voices.filter((v) => !v.lang.endsWith("BR")), "pt")?.name).toBe("PT");
    expect(pickVoice([{ name: "só idioma", lang: "en" }], "en")?.name).toBe("só idioma");
  });

  it("pula as vozes de efeito do macOS, mesmo quando vêm primeiro na lista", () => {
    const mac = [
      { name: "Albert", lang: "en-US" }, { name: "Bad News", lang: "en-US" }, { name: "Bells", lang: "en-US" },
      { name: "Mónica", lang: "es-ES", default: true }, { name: "Samantha", lang: "en-US" }, { name: "Zarvox", lang: "en-US" },
    ];
    expect(pickVoice(mac, "en")?.name).toBe("Samantha");
    expect(pickVoice([{ name: "Whisper", lang: "en-US" }, { name: "Wobble", lang: "en-US" }], "en")).toBeNull();
  });

  it("prefere a voz que soa melhor à padrão do sistema", () => {
    const chrome = [
      { name: "Microsoft Daniel - Portuguese (Brazil)", lang: "pt-BR", default: true, localService: true },
      { name: "Google português do Brasil", lang: "pt-BR", localService: false },
    ];
    expect(pickVoice(chrome, "pt")?.name).toBe("Google português do Brasil");
    const edge = [
      { name: "Microsoft David - English (United States)", lang: "en-US", default: true, localService: true },
      { name: "Microsoft Aria Online (Natural) - English (United States)", lang: "en-US", localService: false },
      { name: "Microsoft Sonia Online (Natural) - English (United Kingdom)", lang: "en-GB", localService: false },
    ];
    expect(pickVoice(edge, "en")?.name).toBe("Microsoft Aria Online (Natural) - English (United States)");
  });

  it("sem internet, a voz instalada passa na frente da que vem da rede", () => {
    const chrome = [
      { name: "Google US English", lang: "en-US", localService: false },
      { name: "Microsoft David - English (United States)", lang: "en-US", localService: true },
    ];
    expect(pickVoice(chrome, "en", true)?.name).toBe("Google US English");
    expect(pickVoice(chrome, "en", false)?.name).toBe("Microsoft David - English (United States)");
    // só há voz da rede: ainda é a escolhida, e a tela avisa se ela não responder
    expect(pickVoice(chrome.slice(0, 1), "en", false)?.name).toBe("Google US English");
  });

  it("sem voz no idioma devolve null", () => {
    expect(pickVoice([{ name: "ES", lang: "es-ES" }], "pt")).toBeNull();
    expect(pickVoice([], "en")).toBeNull();
  });
});

describe("spokenAnswer", () => {
  it("lê a resposta e depois a ressalva, com o rótulo da tela", () => {
    expect(spokenAnswer("Cerca de 53 km². Não é a área alagada.", ["Medida do time."], "Ressalva", "pt"))
      .toEqual(["Cerca de 53 quilômetros quadrados.", "Não é a área alagada.", "Ressalva.", "Medida do time."]);
  });

  it("sem ressalva lê só a resposta", () => {
    expect(spokenAnswer("NISAR is a NASA and ISRO satellite.", [], "Caveat", "en")).toEqual(["NISAR is a NASA and ISRO satellite."]);
  });
});
