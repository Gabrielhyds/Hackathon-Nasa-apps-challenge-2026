import { Injectable, Logger } from "@nestjs/common";
import { mockAsk } from "@nexxus/contract";
import type { AskRequest, AskResponse, AskStreamEvent } from "@nexxus/contract";
import { agentBody, agentResponse } from "./agent-context";
import { servedScenes } from "./scene-images";

/** Erro do agente que tem resposta HTTP certa para o front (hoje, só o limite de perguntas por minuto). */
export class AgentBusyError extends Error {}

/**
 * PONTE PARA O AGENTE (apps/agent, o Mission Guide).
 *
 * Sem AGENT_URL, responde com um texto de exemplo calculado das notas das cenas.
 * Com AGENT_URL, repassa a pergunta ao agente e devolve a resposta dele no formato do contrato. No Docker a
 * variável já vem apontada para o serviço `agent`.
 *
 * O formato do pedido e da resposta do agente está em agent-context.ts.
 *
 * Variáveis de ambiente:
 *   AGENT_URL      endereço que recebe a pergunta (POST, JSON), por exemplo http://agent:8080/api/ask; "off" desliga
 *   AGENT_TOKEN    opcional, só para agente externo que exija login; vai no cabeçalho Authorization: Bearer.
 *                  A chave do modelo (AGENT_API_KEY, no .env) não passa pela API: vai direto ao serviço do agente.
 *   AGENT_TIMEOUT_MS  opcional; padrão 30000 (o agente desiste do modelo em 15 s e responde pela reserva)
 */
@Injectable()
export class AgentService {
  private readonly log = new Logger(AgentService.name);
  private readonly url = AgentService.address(process.env.AGENT_URL);
  private readonly key = process.env.AGENT_TOKEN?.trim() || "";
  private readonly timeout = Number(process.env.AGENT_TIMEOUT_MS) || 30_000;

  /** "off" (ou vazio) desliga o agente: no Docker, vazio já vira o endereço do serviço `agent`. */
  private static address(raw?: string): string {
    const url = raw?.trim() ?? "";
    return url.toLowerCase() === "off" ? "" : url;
  }

  get connected(): boolean {
    return Boolean(this.url);
  }

  /** `clientIp` segue em X-Forwarded-For: o agente limita as perguntas por minuto de cada visitante, não da API. */
  private async callAgent(req: AskRequest, clientIp?: string): Promise<AskResponse> {
    const res = await fetch(this.url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(this.key ? { Authorization: `Bearer ${this.key}` } : {}),
        ...(clientIp ? { "X-Forwarded-For": clientIp } : {}),
      },
      body: JSON.stringify(agentBody(req)),
      signal: AbortSignal.timeout(this.timeout),
    });
    if (res.status === 429) throw new AgentBusyError("Too many questions in a short time. Wait a minute and ask again.");
    if (!res.ok) throw new Error(`Agent answered ${res.status}`);
    // a cena de interferograma entra na lista: o agente pode citá-la, e o front só mostra o botão se a conhecer
    const known = new Set(servedScenes(req.lang ?? "en", ["interferogram"]).scenes.map((s) => s.id));
    return agentResponse(await res.json(), known);
  }

  async ask(req: AskRequest, clientIp?: string): Promise<AskResponse> {
    if (!this.connected) return mockAsk(req, servedScenes(req.lang ?? "en", ["interferogram"]).scenes);
    try {
      return await this.callAgent(req, clientIp);
    } catch (e) {
      this.log.error(`Agent call failed: ${e instanceof Error ? e.message : e}`);
      throw e;
    }
  }

  /**
   * Resposta em pedaços. O agente responde de uma vez (ele confere o texto inteiro antes de soltar), então a
   * resposta pronta é fatiada em palavras; ressalvas e fontes chegam no evento `done`.
   */
  async *stream(req: AskRequest, clientIp?: string): AsyncGenerator<AskStreamEvent> {
    const response = await this.ask(req, clientIp);
    const words = response.answer.split(/(?<=\s)/);
    const pause = this.connected ? 14 : 28;
    for (const text of words) {
      yield { type: "delta", text };
      await new Promise((r) => setTimeout(r, pause));
    }
    yield { type: "done", response };
  }
}
