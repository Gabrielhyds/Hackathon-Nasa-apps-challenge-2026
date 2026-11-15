/**
 * PÚBLICO. A mesma tela é lida de dois jeitos, escolhidos no rodapé da folha:
 * explorar (curioso, sem jargão) e analisar (órbitas, parâmetros e limites).
 * Os dados são os mesmos; muda o que aparece e como é dito.
 * O nível "teach" (Aula) saiu: a atividade da turma abre por um botão no Simples. Link ou escolha lembrada com
 * "teach" não é mais um público válido e cai no Simples.
 */
export type Audience = "explore" | "analyze";
export const AUDIENCES: Audience[] = ["explore", "analyze"];
export const isAudience = (value: unknown): value is Audience => AUDIENCES.includes(value as Audience);

const KEY = "nexxus-audience";
/** Público lembrado da última visita. `null` na primeira. */
export function savedAudience(): Audience | null {
  try { const v = localStorage.getItem(KEY); return isAudience(v) ? v : null; } catch { return null; }
}
export function saveAudience(value: Audience): void {
  try { localStorage.setItem(KEY, value); } catch { /* segue sem lembrar */ }
}
