import { useCallback, useEffect, useRef, useState } from "react";
import type { Lang } from "@nexxus/contract";
import { pickVoice, SPEECH_LANG } from "./speech";

const synth = () => (typeof window !== "undefined" && "speechSynthesis" in window ? window.speechSynthesis : null);

/**
 * Lê texto em voz alta com a voz do navegador. `speaking` é o id do que está sendo lido (ou `null`);
 * `canSpeak(lang)` diz se há voz naquele idioma. Uma leitura por vez: pedir outra interrompe a anterior.
 * Ao desmontar ou sair da página, a leitura para.
 */
export function useSpeech() {
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>(() => synth()?.getVoices() ?? []);
  const [speaking, setSpeaking] = useState<number | null>(null);
  /** Número da leitura da vez: o fim de uma leitura interrompida não apaga o estado da seguinte. */
  const run = useRef(0);
  /** O Chrome pode recolher a fala da memória antes do fim e não avisar que terminou: guardar a referência evita. */
  const queue = useRef<SpeechSynthesisUtterance[]>([]);

  // as vozes chegam depois da página em alguns navegadores
  useEffect(() => {
    const s = synth();
    if (!s) return;
    const load = () => setVoices(s.getVoices());
    load();
    s.addEventListener?.("voiceschanged", load);
    return () => s.removeEventListener?.("voiceschanged", load);
  }, []);

  const stop = useCallback(() => {
    run.current++;
    queue.current = [];
    synth()?.cancel();
    setSpeaking(null);
  }, []);

  const speak = useCallback((id: number, chunks: string[], lang: Lang) => {
    const s = synth();
    if (!s || !chunks.length) return;
    s.cancel();
    const mine = ++run.current;
    const voice = pickVoice(s.getVoices(), lang);
    const done = () => { if (run.current === mine) { queue.current = []; setSpeaking(null); } };
    queue.current = chunks.map((chunk, i) => {
      const utterance = new SpeechSynthesisUtterance(chunk);
      utterance.lang = voice?.lang ?? SPEECH_LANG[lang];
      if (voice) utterance.voice = voice;
      // erro em qualquer pedaço encerra a leitura: o resto da fila não toca sozinho depois
      utterance.onerror = () => { if (run.current === mine) { s.cancel(); done(); } };
      if (i === chunks.length - 1) utterance.onend = done;
      return utterance;
    });
    setSpeaking(id);
    for (const utterance of queue.current) s.speak(utterance);
  }, []);

  // a fala continua depois que a página some, se ninguém a interromper
  useEffect(() => {
    const cancel = () => synth()?.cancel();
    window.addEventListener("pagehide", cancel);
    return () => { window.removeEventListener("pagehide", cancel); cancel(); };
  }, []);

  const canSpeak = useCallback((lang: Lang) => pickVoice(voices, lang) !== null, [voices]);

  return { speaking, canSpeak, speak, stop };
}

export type Speech = ReturnType<typeof useSpeech>;
