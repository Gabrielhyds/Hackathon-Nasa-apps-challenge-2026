import { Injectable } from "@nestjs/common";
import { searchPlaces, useCities } from "@nexxus/contract";
import type { Lang, Place, PlaceKind } from "@nexxus/contract";
import { readCities } from "./places-data";

interface OpenMeteoResult {
  name: string;
  latitude: number;
  longitude: number;
  admin1?: string;
  country?: string;
  country_code?: string;
}

interface Query { kind: PlaceKind | "all"; lang: Lang; countryCode?: string; adminKey?: string }

const plain = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();

/**
 * Busca de lugares.
 * Países e estados vêm da lista embutida (Natural Earth). Cidades vêm da lista completa do GeoNames, lida ao subir:
 * todo lugar povoado com mais de 500 habitantes, sem depender da rede. Só quando nenhuma cidade da lista casa com o
 * texto (um povoado menor, por exemplo) a busca tenta a geocodificação do Open-Meteo, gratuita e sem chave.
 * Desligue essa consulta com PLACES_ONLINE=0. Sem o arquivo da lista completa, ficam as 7,3 mil cidades embutidas.
 */
@Injectable()
export class PlacesService {
  private readonly online = process.env.PLACES_ONLINE !== "0";
  /** Quantas cidades a busca conhece sem rede. */
  readonly cities: number;

  constructor() {
    const all = readCities();
    if (all) useCities(all);
    this.cities = all?.length ?? 0;
  }

  async search(query: string, { kind, lang, countryCode, adminKey }: Query): Promise<Place[]> {
    const q = query.trim();
    const scope = { lang, countryCode, adminKey };
    // listando o que há dentro de um país ou estado, sem texto: só a lista embutida
    if (q.length < 2) return countryCode && !q ? searchPlaces("", { ...scope, kind, limit: 100 }) : [];
    if (kind === "country" || kind === "state") return searchPlaces(q, { ...scope, kind });

    const limit = countryCode ? 100 : 8;
    const regions = kind !== "all" || adminKey ? []
      : countryCode ? searchPlaces(q, { ...scope, kind: "state", limit: 4 })
      : [...searchPlaces(q, { kind: "country", lang, limit: 2 }), ...searchPlaces(q, { kind: "state", lang, limit: 2 })];
    const local = searchPlaces(q, { ...scope, kind: "city", limit });
    const cities = local.length ? local : (await this.onlineCities(q, lang, countryCode, adminKey)) ?? local;
    return [...regions, ...cities].slice(0, limit);
  }

  /** Nomes pelos quais um estado pode vir na resposta online: o identificador e o nome dele nos dois idiomas. */
  private stateNames(countryCode: string | undefined, adminKey: string): Set<string> {
    const names = new Set([plain(adminKey)]);
    if (!countryCode) return names;
    for (const lang of ["en", "pt"] as const) {
      const state = searchPlaces("", { kind: "state", lang, countryCode, limit: Infinity }).find((p) => p.adminKey === adminKey);
      if (state) names.add(plain(state.name));
    }
    return names;
  }

  private async onlineCities(q: string, lang: Lang, countryCode: string | undefined, adminKey: string | undefined): Promise<Place[] | null> {
    if (!this.online) return null;
    try {
      const url = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(q)}&count=${countryCode ? 30 : 8}&language=${lang}&format=json${countryCode ? `&countryCode=${countryCode}` : ""}`;
      const res = await fetch(url, { signal: AbortSignal.timeout(2500) });
      if (!res.ok) return null;
      const data = (await res.json()) as { results?: OpenMeteoResult[] };
      // nomes do estado aceitos no filtro: o identificador e o nome no idioma pedido (o Open-Meteo responde nele)
      const stateNames = adminKey ? this.stateNames(countryCode, adminKey) : null;
      const hits = (data.results ?? [])
        .filter((r) => !countryCode || r.country_code?.toUpperCase() === countryCode)
        .filter((r) => !stateNames || stateNames.has(plain(r.admin1 ?? "")))
        .map((r): Place => ({
          kind: "city", name: r.name, admin: r.admin1, country: r.country,
          countryCode: r.country_code?.toUpperCase(), adminKey: adminKey, lat: r.latitude, lon: r.longitude,
        }));
      return hits.length ? hits : null;
    } catch {
      return null; // sem rede: segue para a lista embutida
    }
  }
}
