/**
 * PONTO ÚNICO DE DADOS DO FRONT.
 * As telas só importam `api` daqui. Para trocar exemplo por dado real, basta
 * VITE_API_MODE=http e VITE_API_URL apontando para a API. Nenhum componente muda.
 */
import type { AskRequest, AskResponse, Lang, Pass, Place, PlaceKind, ScenesResponse } from "@nexxus/contract";
import { httpApi } from "./http";
import { mockApi } from "./mock";

export interface AskOptions {
  /** Chamado a cada pedaço de texto que chega, para a resposta aparecer enquanto é escrita. */
  onDelta?(text: string): void;
  /** Cancela a pergunta em andamento. */
  signal?: AbortSignal;
}

export interface PlaceQuery {
  kind: PlaceKind | "all";
  lang: Lang;
  /** Restringe a busca a um país (código de duas letras). */
  countryCode?: string;
  /** Restringe a busca às cidades de um estado (`Place.adminKey`). */
  adminKey?: string;
}

export interface NexxusApi {
  getScenes(lang: Lang): Promise<ScenesResponse>;
  getPasses(lat: number, lon: number): Promise<Pass[]>;
  searchPlaces(query: string, options: PlaceQuery): Promise<Place[]>;
  /** Devolve a resposta completa. Com `onDelta`, o texto também chega aos poucos. */
  ask(req: AskRequest, options?: AskOptions): Promise<AskResponse>;
}

export const API_MODE: "mock" | "http" = import.meta.env.VITE_API_MODE === "http" ? "http" : "mock";
export const api: NexxusApi = API_MODE === "http" ? httpApi : mockApi;
