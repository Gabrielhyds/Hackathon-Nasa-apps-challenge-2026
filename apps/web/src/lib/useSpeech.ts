import { useCallback, useEffect, useRef, useState } from "react";
import type { Lang } from "@nexxus/contract";
import { pickVoice, SPEECH_LANG } from "./speech";

const synth = () => (typeof window !== "undefined" && "speechSynthesis" in window ? window.speechSynthesis : null);

/** Quanto se espera pela primeira palavra antes de avisar que a voz não respondeu (voz da rede sem conexão, por exemplo). */
const START_LIMIT = 6000;
/** De quanto em quanto tempo se confere se a leitura ainda anda. */
const TICK = 1000;

/**
 * Lê texto em voz alta com a voz do navegador. `speaking` é o id do que está sendo lido (ou `null`) e `failed`,
 * o id da leitura que não saiu; `canSpeak(lang)` diz se vale oferecer a leitura naquele idioma.
 * Uma leitura por vez: pedir outra interrompe a anterior. Ao desmontar ou sair da página, a leitura para.
 */
export function useSpeech() {
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>(() => synth()?.getVoices() ?? []);
  const [speaking, setSpeaking] = useState<number | null>(null);
  const [failed, setFailed] = useState<number | null>(null);
  /** Número da leitura da vez: o fim de uma leitura interrompida não apaga o estado da seguinte. */
  const run = useRef(0);
  /** O Chrome pode recolher a fala da memória antes do fim e não avisar que terminou: guardar a referência evita. */
  const queue = useRef<SpeechSynthesisUtterance[]>([]);
  /** Relógio que vigia a leitura da vez. */
  const watch = useRef<number | null>(null);

  const unwatch = useCallback(() => {
    if (watch.current !== null) { window.clearInterval(watch.current); watch.current = null; }
  }, []);

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
    unwatch();
    synth()?.cancel();
    setSpeaking(null);
    setFailed(null);
  }, [unwatch]);

  const speak = useCallback((id: number, chunks: string[], lang: Lang) => {
    const s = synth();
    if (!s || !chunks.length) return;
    unwatch();
    // cancelar com a fila vazia faz alguns navegadores engolirem a fala seguinte
    if (s.speaking || s.pending) s.cancel();
    // depois de uma fala interrompida o Chrome às vezes fica em pausa, e a seguinte não sai
    if (s.paused) s.resume();
    const mine = ++run.current;
    // lista vazia: o navegador escolhe a voz pelo idioma
    const voice = pickVoice(s.getVoices(), lang, navigator.onLine);
    let started = false;
    let idle = 0;
    /** Encerra a leitura da vez, uma vez só: o que chegar depois (as falas canceladas avisando) é ignorado. */
    const finish = (failure: boolean) => {
      if (run.current !== mine) return;
      run.current++;
      unwatch();
      queue.current = [];
      if (failure) s.cancel();
      setSpeaking(null);
      setFailed(failure ? id : null);
    };
    queue.current = chunks.map((chunk, i) => {
      const utterance = new SpeechSynthesisUtterance(chunk);
      utterance.lang = voice?.lang ?? SPEECH_LANG[lang];
      if (voice) utterance.voice = voice;
      utterance.onstart = () => { started = true; };
      // erro em qualquer pedaço encerra a leitura; interrupção pedida por outra página não é falha
      utterance.onerror = (event) => finish(event.error !== "interrupted" && event.error !== "canceled");
      if (i === chunks.length - 1) utterance.onend = () => finish(false);
      return utterance;
    });
    setFailed(null);
    setSpeaking(id);
    for (const utterance of queue.current) s.speak(utterance);
    // nem todo navegador avisa quando a voz falha: sem a primeira palavra no prazo, a tela avisa; e, se o aviso de
    // fim se perder, a leitura que parou de andar é dada por terminada
    const since = Date.now();
    watch.current = window.setInterval(() => {
      if (!started) { if (Date.now() - since > START_LIMIT) finish(true); return; }
      idle = s.speaking || s.pending ? 0 : idle + 1;
      if (idle >= 2) finish(false);
    }, TICK);
  }, [unwatch]);

  // a fala continua depois que a página some, se ninguém a interromper
  useEffect(() => {
    const cancel = () => synth()?.cancel();
    window.addEventListener("pagehide", cancel);
    return () => { window.removeEventListener("pagehide", cancel); unwatch(); cancel(); };
  }, [unwatch]);

  /**
   * Vale oferecer a leitura? Sim quando há voz no idioma e também quando o navegador não lista voz nenhuma:
   * alguns falam assim mesmo, pelo idioma, e, se não falar, a tela avisa. Só some quando há vozes e nenhuma serve.
   */
  const canSpeak = useCallback((lang: Lang) => synth() !== null && (voices.length === 0 || pickVoice(voices, lang) !== null), [voices]);

  return { speaking, failed, canSpeak, speak, stop };
}

export type Speech = ReturnType<typeof useSpeech>;
