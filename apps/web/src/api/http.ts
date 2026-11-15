import type { AskResponse, AskStreamEvent, Pass, Place, ScenesResponse } from "@nexxus/contract";
import type { NexxusApi } from "./index";

const BASE = (import.meta.env.VITE_API_URL ?? "/api").replace(/\/$/, "");
const JSON_HEADERS = { "Content-Type": "application/json" };

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(BASE + path, init);
  if (!res.ok) throw new Error(`API answered ${res.status} on ${path}`);
  return (await res.json()) as T;
}

/** Lê uma resposta text/event-stream e entrega cada evento `data:` já convertido de JSON. */
async function readEvents(res: Response, onEvent: (event: AskStreamEvent) => void): Promise<void> {
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let cut: number;
    while ((cut = buffer.indexOf("\n\n")) >= 0) {
      const block = buffer.slice(0, cut);
      buffer = buffer.slice(cut + 2);
      const data = block.split("\n").filter((l) => l.startsWith("data:")).map((l) => l.slice(5).trim()).join("\n");
      if (data) onEvent(JSON.parse(data) as AskStreamEvent);
    }
  }
}

/** Chamadas reais. Uma função por rota do contrato. */
export const httpApi: NexxusApi = {
  // a tela já sabe mostrar a cena de interferograma (fase, sem km²): pede junto. No modo de exemplo ela não existe.
  getScenes: (lang) => request<ScenesResponse>(`/scenes?lang=${lang}&include=interferogram`),
  getPasses: (lat, lon) => request<Pass[]>(`/passes?lat=${lat}&lon=${lon}`),
  searchPlaces: (query, { kind, lang, countryCode, adminKey }) => {
    const params = new URLSearchParams({ q: query, kind, lang });
    if (countryCode) params.set("country", countryCode);
    if (adminKey) params.set("admin", adminKey);
    return request<Place[]>(`/places?${params}`);
  },

  async ask(req, { onDelta, signal } = {}) {
    const init: RequestInit = { method: "POST", headers: JSON_HEADERS, body: JSON.stringify(req), signal };
    // Tenta a rota com resposta em pedaços. Se a API só tiver POST /ask, usa a resposta inteira.
    if (onDelta) {
      const res = await fetch(`${BASE}/ask/stream`, { ...init, headers: { ...JSON_HEADERS, Accept: "text/event-stream" } });
      if (res.ok && res.body && res.headers.get("content-type")?.includes("text/event-stream")) {
        let final: AskResponse | null = null;
        let failure: string | null = null;
        await readEvents(res, (event) => {
          if (event.type === "delta") onDelta(event.text);
          else if (event.type === "done") final = event.response;
          else failure = event.message;
        });
        if (failure) throw new Error(failure);
        if (!final) throw new Error("The answer ended before it was complete.");
        return final;
      }
      if (res.status !== 404 && res.status !== 405) throw new Error(`API answered ${res.status} on /ask/stream`);
    }
    const response = await request<AskResponse>("/ask", init);
    onDelta?.(response.answer);
    return response;
  },
};
