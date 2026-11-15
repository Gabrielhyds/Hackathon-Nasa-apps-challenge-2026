import { mockAsk, mockPasses, scenesResponse, searchPlaces } from "@nexxus/contract";
import type { NexxusApi } from "./index";

const wait = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    if (signal?.aborted) return reject(new DOMException("Aborted", "AbortError"));
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => { clearTimeout(timer); reject(new DOMException("Aborted", "AbortError")); }, { once: true });
  });

/** Dados de exemplo dentro do navegador. As pequenas esperas existem para os estados de carregamento aparecerem. */
export const mockApi: NexxusApi = {
  async getScenes(lang) {
    await wait(200);
    return scenesResponse(lang);
  },
  async getPasses(lat, lon) {
    await wait(350);
    return mockPasses(lat, lon);
  },
  async searchPlaces(query, options) {
    return searchPlaces(query, options);
  },
  async ask(req, { onDelta, signal } = {}) {
    await wait(500, signal);
    const response = mockAsk(req);
    if (onDelta) {
      for (const word of response.answer.split(/(?<=\s)/)) {
        await wait(28, signal);
        onDelta(word);
      }
    }
    return response;
  },
};
