import type { Polarization, Scene } from "@nexxus/contract";

/**
 * SÉRIE DE PASSAGENS de uma cena: qual par está sendo comparado, qual polarização,
 * e a sequência que o botão de tocar percorre.
 */

/** Par comparado: índices da passagem de antes e da de depois, com `from < to`. */
export type Steps = [number, number];

/** Par que abre: a primeira contra a última passagem. */
export const fullRange = (count: number): Steps => [0, Math.max(1, count - 1)];

/** Ajusta um par pedido (do endereço ou de um controle) à série: dentro dos limites e com antes < depois. */
export function clampSteps(steps: Steps, count: number): Steps {
  const last = Math.max(1, count - 1);
  const to = Math.min(last, Math.max(1, Math.round(steps[1])));
  const from = Math.min(to - 1, Math.max(0, Math.round(steps[0])));
  return [from, to];
}

/** Move um dos dois extremos sem cruzar o outro. */
export function moveStep(steps: Steps, end: "from" | "to", value: number, count: number): Steps {
  const [from, to] = steps;
  return end === "from" ? clampSteps([Math.min(value, to - 1), to], count) : clampSteps([from, Math.max(value, from + 1)], count);
}

/**
 * Passos da animação: cada passagem contra a anterior, de `from` até `to`.
 * O divisor varre um passo de cada vez, então a imagem nunca salta.
 */
export function walk([from, to]: Steps): Steps[] {
  const out: Steps[] = [];
  for (let k = from + 1; k <= to; k++) out.push([k - 1, k]);
  return out;
}

/** A polarização pedida, se a cena tiver; senão a primeira que a cena traz. */
export function polarizationFor(scene: Pick<Scene, "polarizations">, wanted: Polarization): Polarization {
  return scene.polarizations.includes(wanted) ? wanted : scene.polarizations[0] ?? "HH";
}

/** Quanto da mudança já aconteceu na passagem `k` de `count`, de 0 (primeira) a 1 (última). Usado no exemplo sintético. */
export function growth(k: number, count: number): number {
  if (count < 2 || k <= 0) return 0;
  return Math.min(1, 0.35 + 0.65 * (k / (count - 1)) ** 0.8);
}

/**
 * Escolhe a passagem `k` na régua: ela vira o extremo mais próximo do par. Fora do par, estica o lado de fora;
 * dentro, move o extremo que está mais perto (no empate, o de antes).
 */
export function pickStep([from, to]: Steps, k: number, count: number): Steps {
  if (k === from || k === to) return [from, to];
  if (k < from) return clampSteps([k, to], count);
  if (k > to) return clampSteps([from, k], count);
  return clampSteps(k - from <= to - k ? [k, to] : [from, k], count);
}

/** Dias inteiros entre duas datas AAAA-MM-DD. */
export const daysBetween = (from: string, to: string): number => Math.round((Date.parse(to) - Date.parse(from)) / 86_400_000);

/**
 * Cena de interferograma: cada item de `acquisitions` é um PAR de passagens (`referenceDate` → `date`) e a imagem é
 * a fase, não o brilho. Não há mudança de brilho para medir, polarização para trocar nem exemplo que a substitua.
 */
export const isInterferogram = (scene: Pick<Scene, "kind">): boolean => scene.kind === "interferogram";

/** As duas datas de cada par de uma cena de interferograma, na ordem da série. Par sem `referenceDate` fica de fora. */
export function pairs(scene: Pick<Scene, "acquisitions">): { from: string; to: string }[] {
  return scene.acquisitions.flatMap((a) => (a.referenceDate ? [{ from: a.referenceDate, to: a.date }] : []));
}
