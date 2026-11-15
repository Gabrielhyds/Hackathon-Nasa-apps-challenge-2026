// Gera apps/web/src/assets/sky/stars.json: as estrelas até magnitude 7 que o fundo do globo desenha (lib/sky.ts).
//
// Fonte: stars.8.json do d3-celestial (Olaf Frohn, licença BSD-3), que vem do catálogo Hipparcos:
//   https://github.com/ofrohn/d3-celestial/blob/master/data/stars.8.json
// Saída: uma lista só de inteiros, quatro por estrela, para o arquivo ficar pequeno:
//   ascensão reta × 100 (0 a 36000), declinação × 100, magnitude × 10, índice de cor B−V × 10.
//
// Rodar (precisa de internet):  node scripts/sky-stars.mjs   (ou com o caminho de um stars.8.json já baixado)
import { writeFile } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const URL_ = "https://raw.githubusercontent.com/ofrohn/d3-celestial/master/data/stars.8.json";
const OUT = resolve(dirname(fileURLToPath(import.meta.url)), "../apps/web/src/assets/sky/stars.json");

const src = process.argv[2] ? JSON.parse(await (await import("node:fs/promises")).readFile(process.argv[2], "utf8")) : await (await fetch(URL_)).json();
const flat = [];
const LIMIT = 7;
for (const s of src.features.filter((s) => s.properties.mag <= LIMIT).sort((a, b) => a.properties.mag - b.properties.mag)) {
  const [lon, dec] = s.geometry.coordinates, bv = Number(s.properties.bv);
  flat.push(Math.round((((lon % 360) + 360) % 360) * 100), Math.round(dec * 100), Math.round(s.properties.mag * 10), Math.round((Number.isFinite(bv) ? bv : 0.6) * 10));
}
await writeFile(OUT, JSON.stringify(flat));
console.log(`${flat.length / 4} estrelas em ${OUT}`);
