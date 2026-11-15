/// <reference types="vite/client" />
interface ImportMetaEnv {
  readonly VITE_API_MODE?: "mock" | "http";
  readonly VITE_API_URL?: string;
  /** Pacotes de imagem publicados com a página, para o mapa funcionar sem rede. Ver lib/tiles.ts. */
  readonly VITE_TILE_PACKS?: string;
  readonly VITE_TILE_PACK_EXT?: string;
}
declare module "world-atlas/countries-50m.json" {
  import type { Topology } from "topojson-specification";
  const value: Topology;
  export default value;
}
