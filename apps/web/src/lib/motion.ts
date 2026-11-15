import { useEffect, useRef, useState } from "react";

/** O usuário pediu menos movimento no sistema. Toda animação feita em código consulta isto. */
export const reduceMotion = () => typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

export const clamp01 = (n: number) => Math.max(0, Math.min(1, n));
export const easeOut = (t: number) => 1 - (1 - t) ** 3;
export const easeInOut = (t: number) => (t < 0.5 ? 4 * t ** 3 : 1 - (-2 * t + 2) ** 3 / 2);
/** Passa um pouco do alvo e volta. Usado nos pontos que surgem no mapa. */
export const easeOutBack = (t: number) => 1 + 2.70158 * (t - 1) ** 3 + 1.70158 * (t - 1) ** 2;

/** Leva um número até o alvo aos poucos. Começa em zero, então a primeira aparição conta de 0 até o valor. */
export function useTween(target: number, ms = 500): number {
  const [value, setValue] = useState(() => (reduceMotion() ? target : 0));
  const current = useRef(value);
  useEffect(() => {
    if (reduceMotion()) { current.current = target; setValue(target); return; }
    const from = current.current, start = performance.now();
    let raf = 0;
    const tick = (now: number) => {
      const p = clamp01((now - start) / ms);
      current.current = from + (target - from) * easeOut(p);
      setValue(current.current);
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, ms]);
  return value;
}
