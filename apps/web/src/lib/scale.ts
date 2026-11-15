/** Referências de área conhecidas, em km², da menor para a maior. Os nomes ficam em i18n. */
export type ScaleRef = "pitch" | "centralPark" | "manhattan" | "paris" | "saoPaulo" | "luxembourg" | "jamaica" | "belgium";

const REFS: { id: ScaleRef; km2: number }[] = [
  { id: "pitch", km2: 0.00714 },
  { id: "centralPark", km2: 3.41 },
  { id: "manhattan", km2: 59.1 },
  { id: "paris", km2: 105.4 },
  { id: "saoPaulo", km2: 1521 },
  { id: "luxembourg", km2: 2586 },
  { id: "jamaica", km2: 10991 },
  { id: "belgium", km2: 30689 },
];

export interface ScaleComparison {
  ref: ScaleRef;
  /** `same`: mais ou menos do tamanho da referência. `times`: `times` vezes a referência. */
  kind: "same" | "times";
  times: number;
}

/**
 * Compara uma área com algo conhecido, para dar noção de tamanho.
 * Prefere "do tamanho de" quando alguma referência está a até 25% de distância;
 * senão usa a maior referência que cabe na área e diz quantas vezes.
 */
export function compareArea(km2: number): ScaleComparison | null {
  if (!Number.isFinite(km2) || km2 < REFS[0].km2) return null;
  const close = REFS.slice(1)
    .map((r) => ({ r, off: Math.abs(Math.log(km2 / r.km2)) }))
    .filter(({ r }) => km2 / r.km2 >= 0.8 && km2 / r.km2 <= 1.25)
    .sort((a, b) => a.off - b.off)[0];
  if (close) return { ref: close.r.id, kind: "same", times: 1 };
  const base = [...REFS].reverse().find((r) => r.km2 <= km2)!;
  const ratio = km2 / base.km2;
  // uma casa decimal para poucas vezes, inteiro até cem, depois dois algarismos significativos
  const times = ratio < 3 ? Math.round(ratio * 10) / 10 : ratio < 100 ? Math.round(ratio) : Number(ratio.toPrecision(2));
  return { ref: base.id, kind: "times", times };
}
