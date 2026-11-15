import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";
import type { CityRow } from "@nexxus/contract";

/** Todas as cidades do mundo com mais de 500 habitantes, geradas por scripts/places_data.py. */
export const CITIES_FILE = join(__dirname, "..", "data", "cities.json.gz");

interface Packed {
  adminKeys: string[];
  /** [nome, nome em português ou "", país, lat, lon, posição do estado em adminKeys ou -1] */
  cities: [string, string, string, number, number, number][];
}

/** Lê a lista completa no formato da lista embutida. `null` se o arquivo não existir ou estiver quebrado. */
export function readCities(path: string = CITIES_FILE): CityRow[] | null {
  if (!existsSync(path)) return null;
  try {
    const data = JSON.parse(gunzipSync(readFileSync(path)).toString("utf8")) as Packed;
    return data.cities.map(([name, pt, cc, lat, lon, admin]): CityRow => [name, pt || name, cc, lat, lon, admin < 0 ? "" : data.adminKeys[admin]]);
  } catch {
    return null;
  }
}
