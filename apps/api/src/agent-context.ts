import type { AskMode, AskRequest, AskResponse, Lang, SceneSource } from "@nexxus/contract";

/**
 * TRADUÇÃO ENTRE O CONTRATO DO NEXXUS E O AGENTE (apps/agent, o Mission Guide do Vitor).
 *
 * O agente não recebe as cenas da API: ele responde com a sua própria base de fatos conferidos
 * (apps/agent/data/cards.json), confere a resposta do modelo e cola ele mesmo as ressalvas e as fontes.
 * Daqui só vão a pergunta, o idioma e a cena aberta; de volta vêm a resposta, as ressalvas, as fontes, os cartões
 * usados e o modo (modelo, reserva ou "não sei").
 */

/** Limite de `question` no agente (`AskIn`, em apps/agent/agent/main.py). Acima disso ele recusa com 422. */
export const QUESTION_MAX = 500;

/** Cenas cujo id no Nexxus difere do nome que o agente conhece (`SCENE_CARDS`, em apps/agent/agent/knowledge.py). */
const AGENT_SCENE: Record<string, string> = { "gelo-sul": "campo_de_gelo_sul", laguaira: "venezuela" };

/** Cartões do agente que falam de uma cena com outro id. Os demais cartões de cena têm o id da própria cena. */
const CARD_SCENE: Record<string, string> = {
  taquari_metodo: "taquari", taquari_hidrograma: "taquari", taquari_numeros_antigos: "taquari",
  venezuela: "laguaira", campo_de_gelo_sul: "gelo-sul",
};

/** Corpo de `POST /api/ask` do agente. */
export interface AgentBody {
  question: string;
  lang: Lang;
  /** A cena aberta, no nome que o agente conhece. Com ela, "aqui" e "esta cena" valem por esse lugar. */
  scene?: string;
}

/**
 * O agente aceita uma cena só. Vai a primeira de `sceneIds`: o front manda a cena aberta na frente das marcadas
 * para comparar. Sem cena, ele escolhe os cartões só pelo texto da pergunta.
 * A conversa (`history`) não vai: o agente responde cada pergunta sozinha.
 */
export function agentBody(req: AskRequest): AgentBody {
  const open = req.sceneIds[0];
  return {
    question: req.question.slice(0, QUESTION_MAX),
    lang: req.lang ?? "en",
    ...(open ? { scene: AGENT_SCENE[open] ?? open } : {}),
  };
}

const isMode = (m: unknown): m is AskMode => m === "model" || m === "offline" || m === "no_info";
const isHttp = (url: unknown): url is string => typeof url === "string" && /^https?:\/\//.test(url);

/**
 * Resposta do agente no formato do contrato. `known` são os ids das cenas que a API serve: só cartão de cena
 * conhecida vira citação (o botão que leva ao mapa). Fonte sem endereço http(s) fica de fora.
 */
export function agentResponse(data: unknown, known: ReadonlySet<string>): AskResponse {
  const d = (data && typeof data === "object" ? data : {}) as Record<string, unknown>;
  if (typeof d.answer !== "string" || !d.answer.trim()) throw new Error("Agent sent no `answer`.");
  const cards = Array.isArray(d.cards) ? d.cards.filter((c): c is string => typeof c === "string") : [];
  const cited = [...new Set(cards.map((c) => CARD_SCENE[c] ?? c))].filter((id) => known.has(id));
  const caveats = Array.isArray(d.caveats) ? d.caveats.filter((c): c is string => typeof c === "string" && Boolean(c.trim())) : [];
  const sources: SceneSource[] = (Array.isArray(d.sources) ? d.sources : []).flatMap((s) => {
    const { nome, url } = (s && typeof s === "object" ? s : {}) as { nome?: unknown; url?: unknown };
    return typeof nome === "string" && nome.trim() && isHttp(url) ? [{ title: nome, url }] : [];
  });
  return {
    answer: d.answer.trim(),
    citations: cited.map((sceneId) => ({ sceneId })),
    ...(caveats.length ? { caveats } : {}),
    ...(sources.length ? { sources } : {}),
    ...(isMode(d.mode) ? { mode: d.mode } : {}),
  };
}
