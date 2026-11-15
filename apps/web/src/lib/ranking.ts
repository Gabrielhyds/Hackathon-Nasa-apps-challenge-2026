import type { Criterion, Scene } from "@nexxus/contract";

export type Weights = Record<string, number>;

export interface RankedScene {
  scene: Scene;
  /** Nota final, de 0 a 100. */
  total: number;
  /** Quanto cada critério contribui para a nota, na ordem de `criteria`. A soma é `total`. */
  parts: number[];
}

export const defaultWeights = (criteria: Criterion[]): Weights => Object.fromEntries(criteria.map((c) => [c.id, 3]));

/** Média ponderada das notas. Com todos os pesos em zero, a nota de todas as cenas é zero. */
export function rank(scenes: Scene[], criteria: Criterion[], weights: Weights): RankedScene[] {
  const sum = criteria.reduce((a, c) => a + (weights[c.id] ?? 0), 0);
  return scenes
    .map((scene) => {
      const parts = criteria.map((c) => (sum ? ((scene.scores[c.id] ?? 0) * (weights[c.id] ?? 0)) / sum : 0));
      return { scene, parts, total: parts.reduce((a, b) => a + b, 0) };
    })
    .sort((a, b) => b.total - a.total);
}

/**
 * A ordem em que as cenas aparecem na tela: primeiro as que têm evento documentado, com fonte, depois as que são
 * leitura do time (mudança sazonal). Dentro de cada grupo vale a ordem que chegou (a da nota). As notas são de
 * exemplo; o que o time sabe defender são os eventos, e é por eles que a tela começa.
 */
export function eventsFirst(ranked: RankedScene[]): { events: RankedScene[]; others: RankedScene[] } {
  const documented = (r: RankedScene) => r.scene.basis === "documented-event";
  return { events: ranked.filter(documented), others: ranked.filter((r) => !documented(r)) };
}
