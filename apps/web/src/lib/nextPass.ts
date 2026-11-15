import type { Pass } from "@nexxus/contract";
import { NISAR } from "./geo";

const DAY = 86_400_000;

export interface NextPass {
  direction: Pass["direction"];
  /** AAAA-MM-DD */
  date: string;
  /** Dias até lá, contados a partir de hoje. 0 = hoje. */
  inDays: number;
}

/**
 * Estima quando o NISAR volta a passar pelo lugar: a órbita se repete a cada 12 dias,
 * então a próxima passagem de cada órbita é a última conhecida mais 12 dias, quantas vezes for preciso
 * até cair de hoje em diante. É estimativa: manobras e pausas do satélite não entram na conta.
 * Devolve uma entrada por órbita, a mais próxima primeiro.
 */
export function nextPasses(passes: Pass[], now: number = Date.now()): NextPass[] {
  const today = Math.floor(now / DAY) * DAY;
  const out: NextPass[] = [];
  for (const direction of ["ascending", "descending"] as const) {
    const dates = passes.filter((p) => p.direction === direction).map((p) => Date.parse(p.date)).filter(Number.isFinite);
    if (!dates.length) continue;
    let next = Math.max(...dates);
    while (next < today) next += NISAR.repeatDays * DAY;
    out.push({ direction, date: new Date(next).toISOString().slice(0, 10), inDays: Math.round((next - today) / DAY) });
  }
  return out.sort((a, b) => a.inDays - b.inDays);
}
