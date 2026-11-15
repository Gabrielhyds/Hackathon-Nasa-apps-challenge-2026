import { useCallback, useRef, useState } from "react";
import type { AskMode, ChatMessage, Lang, SceneSource } from "@nexxus/contract";
import { api } from "../api";

export interface ChatTurn {
  id: number;
  question: string;
  answer: string;
  status: "streaming" | "done" | "stopped" | "error";
  citations: string[];
  /** Ressalvas e fontes dos fatos usados, coladas pelo agente depois da resposta. */
  caveats: string[];
  sources: SceneSource[];
  /** De onde saiu a resposta do agente; ausente na resposta de exemplo. */
  mode?: AskMode;
  isExample: boolean;
}

/**
 * Conversa com o agente. Guarda as perguntas e respostas, envia o histórico a cada pergunta
 * e mostra a resposta enquanto ela chega. A chamada em si está em `api.ask`.
 */
export function useChat(sceneIds: string[], lang: Lang) {
  const [turns, setTurns] = useState<ChatTurn[]>([]);
  const controller = useRef<AbortController | null>(null);
  const nextId = useRef(1);
  const latest = useRef({ turns, sceneIds, lang });
  latest.current = { turns, sceneIds, lang };

  const patch = (id: number, change: (t: ChatTurn) => ChatTurn) => setTurns((all) => all.map((t) => (t.id === id ? change(t) : t)));

  const send = useCallback(async (question: string) => {
    const q = question.trim();
    if (!q || controller.current) return;
    const { turns: past, sceneIds: ids, lang: l } = latest.current;
    const history: ChatMessage[] = past
      .filter((t) => t.status === "done")
      .flatMap((t) => [{ role: "user" as const, content: t.question }, { role: "assistant" as const, content: t.answer }]);
    const id = nextId.current++;
    const abort = new AbortController();
    controller.current = abort;
    setTurns((all) => [...all, { id, question: q, answer: "", status: "streaming", citations: [], caveats: [], sources: [], isExample: false }]);
    try {
      const response = await api.ask({ question: q, sceneIds: ids, history, lang: l }, {
        signal: abort.signal,
        onDelta: (text) => patch(id, (t) => ({ ...t, answer: t.answer + text })),
      });
      patch(id, (t) => ({
        ...t, answer: response.answer, status: "done", citations: response.citations.map((c) => c.sceneId),
        caveats: response.caveats ?? [], sources: response.sources ?? [], mode: response.mode, isExample: Boolean(response.isExample),
      }));
    } catch {
      patch(id, (t) => ({ ...t, status: abort.signal.aborted ? "stopped" : "error" }));
    } finally {
      controller.current = null;
    }
  }, []);

  const stop = useCallback(() => controller.current?.abort(), []);
  const retry = useCallback((id: number) => {
    const turn = latest.current.turns.find((t) => t.id === id);
    if (!turn || controller.current) return;
    setTurns((all) => all.filter((t) => t.id !== id));
    latest.current = { ...latest.current, turns: latest.current.turns.filter((t) => t.id !== id) };
    void send(turn.question);
  }, [send]);
  const clear = useCallback(() => { controller.current?.abort(); setTurns([]); }, []);

  return { turns, busy: turns.some((t) => t.status === "streaming"), send, stop, retry, clear };
}

export type Chat = ReturnType<typeof useChat>;
