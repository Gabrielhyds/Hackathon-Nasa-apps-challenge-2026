#!/usr/bin/env node
/**
 * Build para publicar o front como página avulsa dentro de uma moldura isolada (o preview do Claude, por exemplo).
 * Nesse tipo de hospedagem o navegador recusa módulos JavaScript, fontes e fetch dos próprios arquivos da página.
 * Este build contorna isso: um script clássico só, fontes embutidas no CSS, dados de exemplo dentro do navegador
 * e as imagens do globo carregadas por tags <script>.
 *
 *   npm run preview:build     → apps/web/dist-preview
 */
import { execSync } from "node:child_process";
import { readFile, readdir, rm, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const WEB = resolve(ROOT, "apps/web");
const OUT = resolve(WEB, "dist-preview");
const PACKS = ["globe", "regions"];

execSync("npx vite build --outDir dist-preview --emptyOutDir", {
  cwd: WEB, stdio: "inherit",
  env: { ...process.env, NEXXUS_PREVIEW: "1", VITE_API_MODE: "mock" },
});

// pacotes de imagem viram scripts que preenchem window.__NEXXUS_PACKS__
for (const name of PACKS) {
  const index = await readFile(resolve(WEB, `public/tiles/${name}.json`), "utf8");
  const data = (await readFile(resolve(WEB, `public/tiles/${name}.bin`))).toString("base64");
  await writeFile(resolve(OUT, `tiles/${name}.js`), `(window.__NEXXUS_PACKS__=window.__NEXXUS_PACKS__||{})["tiles/${name}"]={index:${index},data:"${data}"};`);
  await rm(resolve(OUT, `tiles/${name}.bin`));
  await rm(resolve(OUT, `tiles/${name}.json`));
}

// script clássico em vez de módulo, sem pedido de CORS, e os pacotes antes da aplicação
let html = await readFile(resolve(OUT, "index.html"), "utf8");
html = html
  .replace(/<script type="module" crossorigin src="([^"]+)"><\/script>/, (_, src) =>
    PACKS.map((n) => `<script defer src="./tiles/${n}.js"></script>`).join("\n    ") + `\n    <script defer src="${src}"></script>`)
  .replace(/<link rel="stylesheet" crossorigin /g, '<link rel="stylesheet" ');
if (html.includes('type="module"') || html.includes("crossorigin")) throw new Error("index.html ainda pede módulo ou CORS");
await writeFile(resolve(OUT, "index.html"), html);

const list = async (dir) => (await readdir(resolve(OUT, dir), { withFileTypes: true })).flatMap((e) => (e.isFile() ? [`${dir ? dir + "/" : ""}${e.name}`] : []));
console.log("\nArquivos do preview:", [...(await list("")), ...(await list("assets")), ...(await list("tiles"))].join(", "));
