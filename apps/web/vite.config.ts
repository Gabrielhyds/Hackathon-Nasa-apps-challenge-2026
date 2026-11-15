import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite";

/**
 * O mapa (MapView, com o MapLibre) é um pedaço à parte, pedido só depois que o código principal roda. Este plugin
 * põe no index.html um aviso para o navegador começar a baixá-lo junto com o principal: o globo aparece mais cedo.
 * Só no build normal; o do preview sai num arquivo só.
 */
function preloadMap(): Plugin {
  return {
    name: "nexxus-preload-map",
    transformIndexHtml(_html, ctx) {
      const chunk = Object.values(ctx.bundle ?? {}).find((c) => c.type === "chunk" && c.name === "MapView");
      return chunk ? [{ tag: "link", attrs: { rel: "modulepreload", crossorigin: true, href: `./${chunk.fileName}` }, injectTo: "head" }] : [];
    },
  };
}

export default defineConfig({
  base: "./",
  plugins: [react(), ...(process.env.NEXXUS_PREVIEW ? [] : [preloadMap()])],
  resolve: {
    alias: { "@nexxus/contract": fileURLToPath(new URL("../../packages/contract/src/index.ts", import.meta.url)) },
  },
  server: {
    port: 5173,
    host: true,
    proxy: { "/api": process.env.API_PROXY ?? "http://localhost:3000" },
    // dentro do Docker em Windows e macOS o aviso de arquivo alterado não chega; VITE_POLL=1 liga a checagem periódica
    watch: process.env.VITE_POLL ? { usePolling: true, interval: 300 } : undefined,
  },
  // NEXXUS_PREVIEW=1: um arquivo só, sem módulos, com as fontes e a trilha de fundo embutidas (as outras imagens, até 400 kB). Ver scripts/preview-build.mjs.
  build: process.env.NEXXUS_PREVIEW
    ? { chunkSizeWarningLimit: 8000, assetsInlineLimit: (file: string, content: Buffer) => /\.mp3$/.test(file) || content.length < 400_000, modulePreload: false, rollupOptions: { output: { format: "iife", inlineDynamicImports: true } } }
    : { chunkSizeWarningLimit: 1500 },
});
