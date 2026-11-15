/**
 * PÚBLICO. A mesma tela é lida de três jeitos, escolhidos no topo:
 * explorar (curioso, sem jargão), ensinar (explicações e perguntas para a turma) e analisar (órbitas, parâmetros e limites).
 * Os dados são os mesmos; muda o que aparece e como é dito.
 */
export type Audience = "explore" | "teach" | "analyze";
export const AUDIENCES: Audience[] = ["explore", "teach", "analyze"];
export const isAudience = (value: unknown): value is Audience => AUDIENCES.includes(value as Audience);

const KEY = "nexxus-audience";
/** Público lembrado da última visita. `null` na primeira. */
export function savedAudience(): Audience | null {
  try { const v = localStorage.getItem(KEY); return isAudience(v) ? v : null; } catch { return null; }
}
export function saveAudience(value: Audience): void {
  try { localStorage.setItem(KEY, value); } catch { /* segue sem lembrar */ }
}
