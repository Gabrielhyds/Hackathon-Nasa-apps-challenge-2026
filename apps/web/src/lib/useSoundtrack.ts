import { useCallback, useEffect, useRef, useState } from "react";
import cosmicUrl from "../assets/audio/cosmic-navigation.mp3";
import exploreUrl from "../assets/audio/exploration-theme.mp3";
import { dataUrlBytes, saveSound, savedSound, TRACKS, type Track } from "./soundtrack";

const URLS: Record<Track, string> = { explore: exploreUrl, data: cosmicUrl };
/** Volume geral: fundo, abaixo de qualquer narração. */
const LEVEL = 0.7;
/** Constante de tempo da transição, em segundos: a troca se completa em cerca de 2,5 s. */
const FADE = 0.8;

interface Engine {
  ctx: AudioContext;
  gains: Record<Track, GainNode>;
  /** Cada faixa é baixada e começa a tocar (em volume zero) na primeira vez em que é pedida. */
  ready: Partial<Record<Track, Promise<void>>>;
}

async function bytesOf(url: string): Promise<ArrayBuffer> {
  const inline = dataUrlBytes(url);
  if (inline) return inline.buffer as ArrayBuffer;
  const response = await fetch(url);
  if (!response.ok) throw new Error(`audio ${response.status}`);
  return response.arrayBuffer();
}

function createEngine(): Engine {
  const ctx = new AudioContext();
  const gain = () => { const node = ctx.createGain(); node.gain.value = 0; node.connect(ctx.destination); return node; };
  return { ctx, gains: { explore: gain(), data: gain() }, ready: {} };
}

function load(engine: Engine, track: Track): Promise<void> {
  return (engine.ready[track] ??= bytesOf(URLS[track]).then((bytes) => engine.ctx.decodeAudioData(bytes)).then((buffer) => {
    const source = engine.ctx.createBufferSource();
    source.buffer = buffer;
    source.loop = true;
    source.connect(engine.gains[track]);
    source.start();
  }));
}

/**
 * Trilha de fundo com duas faixas e transição de volume entre elas. O navegador só deixa o som começar depois de
 * um gesto: com o som ligado, a música entra no primeiro clique ou tecla. Com a aba escondida, pausa.
 * `failed` avisa que o áudio não carregou ou que o navegador não toca.
 */
export function useSoundtrack(track: Track) {
  const [on, setOn] = useState(savedSound);
  const [failed, setFailed] = useState(false);
  const engine = useRef<Engine | null>(null);
  const wanted = useRef(track);
  wanted.current = track;
  /** O ligado ou desligado da vez, lido também por quem termina depois (o áudio acordando, a faixa chegando). */
  const playing = useRef(on);

  /** Leva os volumes ao estado da vez: com o som ligado, a faixa da tela sobe quando estiver carregada; o resto desce. */
  const mix = useCallback(() => {
    const e = engine.current;
    if (!e) return;
    const target = wanted.current;
    const now = e.ctx.currentTime;
    for (const id of TRACKS) if (!playing.current || id !== target) e.gains[id].gain.setTargetAtTime(0, now, FADE);
    if (!playing.current) return;
    load(e, target).then(() => {
      // a faixa pode chegar depois de alguém desligar o som ou mudar de tela
      if (playing.current && wanted.current === target) e.gains[target].gain.setTargetAtTime(LEVEL, e.ctx.currentTime, FADE);
    }).catch(() => { delete e.ready[target]; setFailed(true); });
  }, []);

  /** Só funciona dentro de um gesto do usuário. Devolve se o som está tocando. */
  const wake = useCallback(async (): Promise<boolean> => {
    try {
      const e = (engine.current ??= createEngine());
      if (e.ctx.state !== "running") await e.ctx.resume();
      if (e.ctx.state !== "running") return false;
      setFailed(false);
      mix();
      return true;
    } catch { setFailed(true); return false; }
  }, [mix]);

  // som ligado e ainda mudo: espera o primeiro gesto em qualquer lugar da página
  useEffect(() => {
    if (!on || engine.current?.ctx.state === "running") return;
    const events = ["pointerdown", "pointerup", "click", "keydown"] as const;
    const off = () => events.forEach((name) => document.removeEventListener(name, onGesture, true));
    const onGesture = () => { void wake().then((ok) => { if (ok) off(); }); };
    events.forEach((name) => document.addEventListener(name, onGesture, true));
    return off;
  }, [on, wake]);

  // mudou a tela ou o botão: acerta os volumes
  useEffect(() => { if (engine.current?.ctx.state === "running") mix(); }, [track, on, mix]);

  // aba escondida não toca
  useEffect(() => {
    const onVisibility = () => {
      const ctx = engine.current?.ctx;
      if (!ctx) return;
      if (document.hidden) void ctx.suspend(); else if (on) void ctx.resume().catch(() => undefined);
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, [on]);

  useEffect(() => () => { void engine.current?.ctx.close(); engine.current = null; }, []);

  const toggle = useCallback(() => {
    // depois de uma falha o botão diz "clique para tentar de novo": o clique tenta, sem desligar
    if (failed && playing.current) { void wake(); return; }
    const next = !playing.current;
    playing.current = next;
    setOn(next);
    saveSound(next);
    if (next) void wake(); // o clique no botão já é o gesto
    else mix();
  }, [failed, wake, mix]);

  return { on, failed, toggle };
}
