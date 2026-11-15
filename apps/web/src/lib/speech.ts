/**
 * LEITURA EM VOZ ALTA das respostas do agente, pela voz do próprio navegador (Web Speech API): sem chave,
 * sem servidor e sem custo. Aqui fica só a regra, que é pura; quem fala é lib/useSpeech.ts.
 *
 * Limites: a voz é a que o sistema ou o navegador tiver, e muda de uma máquina para outra; quando a lista de
 * vozes não tem nenhuma no idioma da resposta, o botão não aparece. O Chrome corta falas longas com as vozes
 * que vêm da rede (cerca de 15 s), por isso o texto vai em pedaços de uma frase.
 */
import type { Lang } from "@nexxus/contract";

/** Idioma que a voz do navegador recebe. */
export const SPEECH_LANG: Record<Lang, string> = { en: "en-US", pt: "pt-BR" };

interface Words { km2: [string, string]; km: [string, string]; cm: [string, string]; m: [string, string]; db: string; mhz: string; minus: string; times: string }
const WORDS: Record<Lang, Words> = {
  en: {
    km2: ["square kilometer", "square kilometers"], km: ["kilometer", "kilometers"], cm: ["centimeter", "centimeters"],
    m: ["meter", "meters"], db: "decibels", mhz: "megahertz", minus: "minus", times: "times",
  },
  pt: {
    km2: ["quilômetro quadrado", "quilômetros quadrados"], km: ["quilômetro", "quilômetros"], cm: ["centímetro", "centímetros"],
    m: ["metro", "metros"], db: "decibéis", mhz: "megahertz", minus: "menos", times: "vezes",
  },
};

const NUMBER = String.raw`(\d+(?:[.,]\d+)?)`;
const one = (value: string) => value === "1";

/**
 * Escreve por extenso o que a voz sintética lê mal: unidades, o sinal de menos e o × da sensibilidade.
 * "53 km²" vira "53 quilômetros quadrados" e "−12 dB", "menos 12 decibéis". O número fica como está.
 */
export function speakable(text: string, lang: Lang): string {
  const w = WORDS[lang];
  const unit = (pattern: string, names: [string, string]) => (input: string) =>
    input.replace(new RegExp(`${NUMBER}\\s*${pattern}`, "g"), (_, value: string) => `${value} ${one(value) ? names[0] : names[1]}`);
  let out = text.replace(/\s+/g, " ").trim();
  // só o sinal de menos de verdade (U+2212, o que os cartões usam): hífen e travessão entre datas ficam como estão
  out = out.replace(/(^|[\s(])−\s*(?=\d)/g, `$1${w.minus} `);
  out = unit("km(?:²|2)(?![\\w])", w.km2)(out);
  out = unit("km(?![\\w²])", w.km)(out);
  out = unit("cm(?![\\w²])", w.cm)(out);
  out = unit("m(?![\\w²])", w.m)(out);
  out = out.replace(new RegExp(`${NUMBER}\\s*dB(?![\\w])`, "g"), `$1 ${w.db}`);
  out = out.replace(new RegExp(`${NUMBER}\\s*MHz(?![\\w])`, "g"), `$1 ${w.mhz}`);
  out = out.replace(new RegExp(`${NUMBER}\\s*×`, "g"), `$1 ${w.times}`);
  return out;
}

/**
 * Parte o texto em pedaços curtos, um por frase; frase longa demais quebra na vírgula ou, sem vírgula, no espaço.
 * Número decimal não parte: o ponto só fecha a frase quando vem seguido de espaço.
 */
export function speechChunks(text: string, max = 200): string[] {
  const chunks: string[] = [];
  const push = (piece: string) => { const clean = piece.trim(); if (clean) chunks.push(clean); };
  for (const sentence of text.split(/(?<=[.!?…])\s+|\n+/)) {
    if (sentence.length <= max) { push(sentence); continue; }
    let line = "";
    for (const part of sentence.split(/(?<=[,;:])\s+/)) {
      if (line && line.length + 1 + part.length > max) { push(line); line = ""; }
      if (part.length <= max) { line = line ? `${line} ${part}` : part; continue; }
      for (const word of part.split(/\s+/)) {
        if (line && line.length + 1 + word.length > max) { push(line); line = ""; }
        line = line ? `${line} ${word}` : word;
      }
    }
    push(line);
  }
  return chunks;
}

/** O que a escolha da voz precisa saber de cada uma (as do navegador têm mais campos). */
export interface VoiceLike { lang: string; name?: string; default?: boolean; localService?: boolean }

/** Vozes de efeito do macOS (sinos, robôs, sussurro) e as sintéticas antigas: vêm marcadas como inglês, mas não servem para ler. */
const NOVELTY = /^(albert|bad news|bahh|bells|boing|bubbles|cellos|deranged|fred|good news|hysterical|jester|junior|kathy|organ|pipe organ|princess|ralph|superstar|trinoids|whisper|wobble|zarvox)\b/i;
/** Vozes neurais, do Edge e dos sistemas: as que mais parecem gente. */
const NATURAL = /natural|neural|enhanced|premium/i;
/** Vozes boas conhecidas: as do Google no Chrome e as principais da Apple, em inglês e em português do Brasil. */
const GOOD = /^google\b|samantha|allison|\bava\b|luciana|felipe/i;

/**
 * A voz para o idioma, pela ordem do que soa melhor: neural, depois as boas conhecidas; a do país certo (pt-BR, en-US)
 * e a padrão do sistema desempatam; no empate, a primeira da lista. As vozes de efeito ficam de fora. Sem internet
 * (`online` falso), a voz instalada no sistema passa na frente da que vem da rede. Sem voz no idioma devolve `null`.
 */
export function pickVoice<V extends VoiceLike>(voices: readonly V[], lang: Lang, online = true): V | null {
  const code = (voice: V) => voice.lang.replace("_", "-").toLowerCase(); // o Android escreve pt_BR
  const wanted = SPEECH_LANG[lang].toLowerCase();
  const score = (voice: V) => {
    const name = voice.name ?? "";
    return (NATURAL.test(name) ? 3 : GOOD.test(name) ? 2 : 0) + (code(voice) === wanted ? 2 : 0) + (voice.default ? 1 : 0)
      + (!online && voice.localService === false ? -6 : 0);
  };
  let best: V | null = null;
  for (const voice of voices) {
    const c = code(voice);
    if (c !== lang && !c.startsWith(`${lang}-`)) continue;
    if (NOVELTY.test(voice.name ?? "")) continue;
    if (!best || score(voice) > score(best)) best = voice;
  }
  return best;
}

/** O que é lido de uma resposta: o texto e, depois, a ressalva, anunciada pelo rótulo que a tela mostra. */
export function spokenAnswer(answer: string, caveats: readonly string[], caveatLabel: string, lang: Lang): string[] {
  const parts = [answer, ...(caveats.length ? [`${caveatLabel}. ${caveats.join(" ")}`] : [])];
  return parts.flatMap((part) => speechChunks(speakable(part, lang)));
}
