import { Injectable, Logger } from "@nestjs/common";
import { mockPasses } from "@nexxus/contract";
import type { Pass } from "@nexxus/contract";
import { NISAR_GCOV_COLLECTIONS, cmrToPasses, cmrUrl } from "./cmr";
import type { CmrResponse } from "./cmr";

const TIMEOUT_MS = 6000;
/** Resposta do CMR guardada por 30 min. */
const TTL_MS = 30 * 60_000;
/** Depois de uma falha, nenhum ponto consulta o CMR por 1 min: sem rede, só o primeiro clique espera. */
const COOLDOWN_MS = 60_000;
const CACHE_MAX = 500;

/**
 * Passagens do NISAR sobre um ponto, do catálogo público da NASA (CMR), nas três coleções GCOV.
 * Se qualquer coleção falhar, responde com passagens de exemplo marcadas com `isExample` e avisa no log:
 * não mistura dado parcial com real. Lista vazia não é falha: é ponto sem cobertura.
 * Desligue a consulta com PASSES_ONLINE=0.
 */
@Injectable()
export class PassesService {
  private readonly online = process.env.PASSES_ONLINE !== "0";
  private readonly cache = new Map<string, { until: number; passes: Pass[] }>();
  private readonly log = new Logger("Passes");
  private downUntil = 0;
  /** De onde veio a última resposta. Aparece em GET /health. */
  source: "nisar" | "example" = this.online ? "nisar" : "example";

  async list(latRaw: number, lonRaw: number): Promise<Pass[]> {
    // arredonda a uns 1 km: cliques vizinhos aproveitam a mesma consulta
    const lat = Math.round(latRaw * 100) / 100;
    const lon = Math.round(lonRaw * 100) / 100;
    if (!this.online) return mockPasses(lat, lon);

    const key = `${lat},${lon}`;
    const hit = this.cache.get(key);
    if (hit && hit.until > Date.now()) { this.source = "nisar"; return hit.passes; }
    if (Date.now() < this.downUntil) { this.source = "example"; return mockPasses(lat, lon); }

    try {
      const responses = await Promise.all(NISAR_GCOV_COLLECTIONS.map((c) => this.fetchCollection(c, lat, lon)));
      const passes = cmrToPasses(responses);
      this.source = "nisar";
      this.cache.delete(key);
      if (this.cache.size >= CACHE_MAX) this.cache.delete(this.cache.keys().next().value!);
      this.cache.set(key, { until: Date.now() + TTL_MS, passes });
      return passes;
    } catch (e) {
      this.log.warn(`CMR falhou em ${key} (${e instanceof Error ? e.message : String(e)}). Respondendo com passagens de exemplo por 1 min.`);
      this.downUntil = Date.now() + COOLDOWN_MS;
      this.source = "example";
      return mockPasses(lat, lon);
    }
  }

  private async fetchCollection(collection: string, lat: number, lon: number): Promise<CmrResponse> {
    const res = await fetch(cmrUrl(collection, lat, lon), { signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (!res.ok) throw new Error(`${collection} respondeu ${res.status}`);
    return (await res.json()) as CmrResponse;
  }
}
