import { Injectable, Logger } from "@nestjs/common";
import { mockAsk } from "@nexxus/contract";
import type { AskRequest, AskResponse, AskStreamEvent, ScenesResponse } from "@nexxus/contract";
import { agentBody } from "./agent-context";
import { servedScenes } from "./scene-images";

/**
 * PONTE PARA O AGENTE.
 *
 * Sem AGENT_URL, responde com um texto de exemplo calculado das notas das cenas.
 * Com AGENT_URL, repassa a pergunta para a API do agente e devolve a resposta dela.
 *
 * Para ligar o agente de verdade, o único lugar a mexer é `callAgent`, logo abaixo, e o corpo enviado, em
 * agent-context.ts: ajuste os dois ao formato da API escolhida.
 *
 * Variáveis de ambiente:
 *   AGENT_URL      endereço que recebe a pergunta (POST, JSON)
 *   AGENT_API_KEY  opcional; vai no cabeçalho Authorization: Bearer
 *   AGENT_TIMEOUT_MS  opcional; padrão 60000
 */
@Injectable()
export class AgentService {
  private readonly log = new Logger(AgentService.name);
  private readonly url = process.env.AGENT_URL?.trim() || "";
  private readonly key = process.env.AGENT_API_KEY?.trim() || "";
  private readonly timeout = Number(process.env.AGENT_TIMEOUT_MS) || 60_000;

  get connected(): boolean {
    return Boolean(this.url);
  }

  /**
   * As cenas que servem de contexto: as mesmas de `GET /scenes`, com datas, granules e versões reais, mais a de
   * interferograma, para o agente responder sobre ela quando o front a tiver aberta.
   */
  private served(req: AskRequest): ScenesResponse {
    return servedScenes(req.lang ?? "en", ["interferogram"]);
  }

  /** ADAPTE AQUI ao formato da API do agente. O corpo enviado é montado em agent-context.ts. */
  private async callAgent(req: AskRequest): Promise<AskResponse> {
    const body = agentBody(req, this.served(req));
    const res = await fetch(this.url, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(this.key ? { Authorization: `Bearer ${this.key}` } : {}) },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(this.timeout),
    });
    if (!res.ok) throw new Error(`Agent API answered ${res.status}`);
    const data = (await res.json()) as { answer?: unknown; citations?: unknown };
    if (typeof data.answer !== "string" || !data.answer.trim()) throw new Error("Agent API sent no `answer`.");
    const known = new Set(body.scenes.map((s) => s.id));
    const cited = Array.isArray(data.citations) ? data.citations.filter((c): c is string => typeof c === "string" && known.has(c)) : [];
    return { answer: data.answer, citations: cited.map((sceneId) => ({ sceneId })) };
  }

  async ask(req: AskRequest): Promise<AskResponse> {
    if (!this.connected) return mockAsk(req, this.served(req).scenes);
    try {
      return await this.callAgent(req);
    } catch (e) {
      this.log.error(`Agent call failed: ${e instanceof Error ? e.message : e}`);
      throw e;
    }
  }

  /**
   * Resposta em pedaços. Hoje a resposta inteira é fatiada em palavras; se a API do agente
   * transmitir em tempo real, troque este método para repassar os pedaços dela como eventos `delta`.
   */
  async *stream(req: AskRequest): AsyncGenerator<AskStreamEvent> {
    const response = await this.ask(req);
    const words = response.answer.split(/(?<=\s)/);
    for (const text of words) {
      yield { type: "delta", text };
      if (!this.connected) await new Promise((r) => setTimeout(r, 28));
    }
    yield { type: "done", response };
  }
}
