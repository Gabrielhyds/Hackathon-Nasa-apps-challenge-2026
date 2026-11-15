import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { App } from "./App";
import { I18nProvider } from "./i18n";
import { startVitals } from "./lib/perf";
// fonte embutida na página, para a tela ficar igual sem internet
import "@fontsource-variable/funnel-display/wght.css";
import "@fontsource-variable/host-grotesk/wght.css";
import "@fontsource-variable/geist-mono/wght.css";
// o estilo do MapLibre entra antes do nosso: styles.css posiciona o mapa e precisa valer por último.
// (se ele fosse junto com o mapa, que é baixado à parte, chegaria depois e desfaria o tamanho do mapa)
import "maplibre-gl/dist/maplibre-gl.css";
import "./styles.css";

// métricas do navegador (LCP, INP, CLS…): sempre medidas; o painel aparece com ?perf=1
startVitals();

const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 60_000, retry: 1, refetchOnWindowFocus: false } },
});

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <I18nProvider>
        <App />
      </I18nProvider>
    </QueryClientProvider>
  </StrictMode>,
);
