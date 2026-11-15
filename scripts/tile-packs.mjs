#!/usr/bin/env node
/**
 * Gera os pacotes de imagem de satélite que o mapa usa sem rede.
 * Baixa o Blue Marble da NASA (GIBS, público, sem chave) e grava em apps/web/public/tiles:
 *   globe    o mundo inteiro, do zoom 0 ao 4
 *   regions  os arredores de cada cena, do zoom 5 ao 8
 * Cada pacote é um .bin com as imagens em sequência e um .json com { "z/x/y": [início, tamanho] }.
 *
 * Rode de novo quando mudar a lista de cenas:
 *   docker compose -f docker-compose.dev.yml run --rm dev npm run tiles
 */
import { mkdir, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = resolve(ROOT, "apps/web/public/tiles");
const URL_OF = (z, x, y) => `https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/BlueMarble_ShadedRelief_Bathymetry/default/GoogleMapsCompatible_Level8/${z}/${y}/${x}.jpeg`;
/** Margem em volta de cada cena, em graus: o que aparece na tela quando a cena está aberta. */
const MARGIN = { lon: 5, lat: 3.5 };

const tileX = (lon, z) => Math.floor(((lon + 180) / 360) * 2 ** z);
const tileY = (lat, z) => {
  const r = (Math.max(-85, Math.min(85, lat)) * Math.PI) / 180;
  return Math.floor(((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * 2 ** z);
};

function globeTiles() {
  const keys = [];
  for (let z = 0; z <= 4; z++) for (let x = 0; x < 2 ** z; x++) for (let y = 0; y < 2 ** z; y++) keys.push([z, x, y]);
  return keys;
}

function regionTiles(scenes) {
  const seen = new Map();
  for (const s of scenes) {
    for (let z = 5; z <= 8; z++) {
      const n = 2 ** z;
      const x0 = tileX(s.lon - MARGIN.lon, z), x1 = tileX(s.lon + MARGIN.lon, z);
      const y0 = tileY(s.lat + MARGIN.lat, z), y1 = tileY(s.lat - MARGIN.lat, z);
      for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) {
        const wrapped = ((x % n) + n) % n;
        if (y >= 0 && y < n) seen.set(`${z}/${wrapped}/${y}`, [z, wrapped, y]);
      }
    }
  }
  return [...seen.values()];
}

async function download([z, x, y]) {
  for (let attempt = 1; ; attempt++) {
    try {
      const res = await fetch(URL_OF(z, x, y), { signal: AbortSignal.timeout(30_000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return Buffer.from(await res.arrayBuffer());
    } catch (e) {
      if (attempt >= 4) throw new Error(`Falhou ${z}/${x}/${y}: ${e.message}`);
      await new Promise((r) => setTimeout(r, 800 * attempt));
    }
  }
}

async function pack(name, tiles) {
  const index = {}, parts = [];
  let offset = 0, next = 0;
  const results = new Array(tiles.length);
  // oito downloads por vez: rápido sem abusar do servidor
  await Promise.all(Array.from({ length: 8 }, async () => {
    while (next < tiles.length) {
      const i = next++;
      results[i] = await download(tiles[i]);
      if ((i + 1) % 100 === 0) console.log(`  ${name}: ${i + 1} de ${tiles.length}`);
    }
  }));
  tiles.forEach(([z, x, y], i) => {
    index[`${z}/${x}/${y}`] = [offset, results[i].length];
    parts.push(results[i]);
    offset += results[i].length;
  });
  await writeFile(resolve(OUT, `${name}.bin`), Buffer.concat(parts));
  await writeFile(resolve(OUT, `${name}.json`), JSON.stringify(index));
  console.log(`${name}: ${tiles.length} imagens, ${(offset / 1e6).toFixed(1)} MB`);
}

let scenes;
try {
  scenes = createRequire(import.meta.url)(resolve(ROOT, "packages/contract/dist/index.js")).scenes("en", ["interferogram"]); // com a cena de interferograma, para ela ter fundo sem rede
} catch {
  console.error("Compile o contrato antes: npm run build -w @nexxus/contract");
  process.exit(1);
}
await mkdir(OUT, { recursive: true });
await pack("globe", globeTiles());
await pack("regions", regionTiles(scenes));
