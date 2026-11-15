import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { Place, Polarization } from "@nexxus/contract";
import { API_MODE, api } from "./api";
import { AskPanel } from "./components/AskPanel";
import { Intro } from "./components/Intro";
import { PerfPanel } from "./components/PerfPanel";
import type { MapHandle } from "./components/MapView";
import type { MapAnalysis } from "./lib/analysis";
import { PassesPanel } from "./components/PassesPanel";
import { PlaceSearch } from "./components/PlaceSearch";
import { SceneIndex } from "./components/SceneIndex";
import { SceneSheet } from "./components/SceneSheet";
import { LANGS, useI18n } from "./i18n";
import { AUDIENCES, saveAudience, savedAudience, type Audience } from "./lib/audience";
import { recordSinceStart } from "./lib/perf";
import { defaultWeights, rank, type Weights } from "./lib/ranking";
import { useChat } from "./lib/useChat";
import type { Steps } from "./lib/series";
import { buildUrlState, parseUrlState, type Lab as LabId, type Tab, type View } from "./lib/urlState";

/**
 * O mapa (MapLibre) é o pedaço mais pesado da página. Ele é baixado à parte, em paralelo,
 * para o topo e a folha lateral aparecerem sem esperar por ele.
 */
const MapView = lazy(() => import("./components/MapView").then((m) => ({ default: m.MapView })));
// o laboratório (gráfico da cheia, simulação do pulso, régua de franjas e as imagens deles) só é baixado quando é aberto
const Lab = lazy(() => import("./components/Lab").then((m) => ({ default: m.Lab })));

/** O que o endereço da página pedia quando ela abriu. Ver lib/urlState.ts. */
const LINK = parseUrlState(window.location.search);
const DEEP_LINK = Boolean(LINK.scene || LINK.place || LINK.tab || LINK.aud || LINK.lab);
const TABS: Tab[] = ["scenes", "passes", "ask"];
const INTRO_KEY = "nexxus-intro-seen";

/** A abertura aparece sozinha só na primeira visita. Depois, pelo botão no topo. */
function firstVisit(): boolean {
  try { return localStorage.getItem(INTRO_KEY) !== "1"; } catch { return true; }
}

export function App() {
  const { t, f, lang, setLang } = useI18n();
  const map = useRef<MapHandle | null>(null);
  /** Movimento pedido antes de o mapa terminar de baixar. Roda quando ele chega. */
  const pendingMove = useRef<((handle: MapHandle) => void) | null>(null);
  const attachMap = useCallback((handle: MapHandle | null) => {
    map.current = handle;
    if (handle && pendingMove.current) { pendingMove.current(handle); pendingMove.current = null; }
  }, []);
  const move = (run: (handle: MapHandle) => void) => { if (map.current) run(map.current); else pendingMove.current = run; };
  const scenesQuery = useQuery({ queryKey: ["scenes", lang], queryFn: () => api.getScenes(lang), placeholderData: (previous) => previous });
  const criteria = scenesQuery.data?.criteria ?? [];
  const scenes = scenesQuery.data?.scenes ?? [];

  const [tab, setTab] = useState<Tab>(LINK.tab ?? "scenes");
  /** Quem está lendo. Um link com ?aud= vale mais que a escolha lembrada. */
  const [audience, setAudienceState] = useState<Audience>(() => LINK.aud ?? savedAudience() ?? "explore");
  const setAudience = (next: Audience) => { setAudienceState(next); saveAudience(next); };
  const [weights, setWeights] = useState<Weights>({});
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [picked, setPicked] = useState<string[]>([]);
  const [place, setPlace] = useState<Place | null>(LINK.place ?? null);
  /** O usuário abriu uma cena de propósito (em vez de só ver a primeira selecionada no globo). */
  const [opened, setOpened] = useState(false);
  /** O usuário mexeu nas caixas de comparar. */
  const [pickedByUser, setPickedByUser] = useState(LINK.compare !== undefined);
  const [view, setView] = useState<View>(LINK.view ?? "swipe");
  /** Medidas do par em tela na cena em foco, contadas pelo mapa para a aba Medir e para a atividade da turma. */
  const [analysis, setAnalysis] = useState<MapAnalysis | null>(null);
  const [pol, setPol] = useState<Polarization>(LINK.pol ?? "HH");
  /** Par de passagens escolhido na cena em foco do mapa; só vai para o endereço se for a cena aberta. */
  const [series, setSeries] = useState<{ sceneId: string | null; steps: Steps | undefined }>({ sceneId: LINK.scene ?? null, steps: LINK.steps });
  const [hoverId, setHoverId] = useState<string | null>(null);
  /** Painel do laboratório aberto por cima do mapa: o hidrograma ou uma das duas peças de física. */
  const [lab, setLab] = useState<LabId | null>(LINK.lab ?? null);
  const closeLab = useCallback(() => setLab(null), []);
  // quem chega por um link para uma cena ou lugar vai direto para lá, sem a abertura
  const [intro, setIntro] = useState(() => firstVisit() && !DEEP_LINK);
  // o agente responde sobre a cena aberta e as marcadas para comparar
  const context = useMemo(() => [...new Set([selectedId, ...picked].filter((id): id is string => Boolean(id)))], [selectedId, picked]);
  const chat = useChat(context, lang);

  const fullWeights = useMemo(() => ({ ...defaultWeights(criteria), ...weights }), [criteria, weights]);
  const ranked = useMemo(() => rank(scenes, criteria, fullWeights), [scenes, criteria, fullWeights]);

  // desempenho: quanto tempo até as cenas chegarem
  useEffect(() => { if (scenesQuery.data) recordSinceStart("scenes"); }, [scenesQuery.data]);

  // primeira carga: seleciona a melhor cena e marca as duas primeiras para comparar
  useEffect(() => {
    if (!ranked.length || selectedId) return;
    const linked = ranked.find((r) => r.scene.id === LINK.scene)?.scene;
    const known = (ids: string[]) => ids.filter((id) => ranked.some((r) => r.scene.id === id));
    setSelectedId(linked?.id ?? ranked[0].scene.id);
    setPicked(LINK.compare ? known(LINK.compare) : ranked.slice(0, 2).map((r) => r.scene.id));
    // link para uma cena ou um lugar: o mapa já abre lá. Com os dois, a aba diz qual está em foco.
    if (LINK.place && (!linked || LINK.tab === "passes")) { const target = LINK.place; move((m) => m.flyToPlace(target)); }
    else if (linked) { setOpened(true); move((m) => m.flyToScene(linked)); }
  }, [ranked, selectedId]);

  // mantém o endereço em dia com a tela, sem criar entradas no histórico
  useEffect(() => {
    if (!selectedId) return; // ainda carregando: não apaga o que o link pedia
    const query = buildUrlState({
      scene: opened ? selectedId : undefined,
      view: opened ? view : undefined,
      pol,
      steps: opened && series.sceneId === selectedId ? series.steps : undefined,
      compare: pickedByUser ? picked : undefined,
      tab, place: place ?? undefined,
      lang: lang === "en" ? undefined : lang,
      aud: audience,
      lab: lab ?? undefined,
      perf: LINK.perf,
    }, window.location.search);
    // dentro de uma moldura isolada o navegador pode recusar: a página segue, só sem o endereço atualizado
    try { window.history.replaceState(null, "", window.location.pathname + query + window.location.hash); } catch { /* sem endereço */ }
  }, [opened, selectedId, view, pol, series, picked, pickedByUser, tab, place, lang, audience, lab]);

  const passesQuery = useQuery({
    queryKey: ["passes", place?.lat, place?.lon],
    queryFn: () => api.getPasses(place!.lat, place!.lon),
    enabled: Boolean(place),
  });

  const closeIntro = useCallback(() => {
    setIntro(false);
    try { localStorage.setItem(INTRO_KEY, "1"); } catch { /* segue sem lembrar */ }
  }, []);
  function openScene(id: string) {
    const scene = scenes.find((s) => s.id === id);
    if (!scene) return;
    if (intro) closeIntro();
    setSelectedId(id);
    setOpened(true);
    setTab("scenes");
    move((m) => m.flyToScene(scene));
    requestAnimationFrame(() => document.querySelector(`[data-scene="${id}"]`)?.scrollIntoView({ block: "nearest" }));
  }
  function choosePlace(next: Place, fly: boolean) {
    if (intro) closeIntro();
    setPlace(next);
    setTab("passes");
    if (fly) move((m) => m.flyToPlace(next));
  }
  // o hidrograma é da cena aberta, se ela tiver um; senão, da primeira que tiver
  const hydroScene = scenes.find((s) => s.id === selectedId && s.waterSeries) ?? scenes.find((s) => s.waterSeries);
  function openLab(panel: LabId) {
    if (intro) closeIntro();
    setLab(panel);
  }
  const togglePick = (id: string) => {
    setPickedByUser(true);
    setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id].slice(-3)));
  };

  return (
    <div className={intro ? "app app--intro" : "app"} data-aud={audience}>
      <main className="stage">
        <Suspense fallback={<div className="map"><p className="map__status">{t.map.loading}</p></div>}>
          <MapView
            ref={attachMap}
            audience={audience}
            scenes={scenes}
            selectedId={selectedId}
            hoverId={hoverId}
            place={place}
            passes={passesQuery.data}
            onSelectScene={openScene}
            onHoverScene={setHoverId}
            initialView={LINK.view}
            onViewChange={setView}
            onAnalysis={setAnalysis}
            initialPol={LINK.pol}
            initialSteps={LINK.steps}
            linkedScene={LINK.scene}
            onSeriesChange={(state) => { setPol(state.pol); setSeries({ sceneId: state.sceneId, steps: state.steps }); }}
            onHome={() => setOpened(false)}
            onPickPoint={(lat, lon) => choosePlace({ kind: "city", name: t.map.point(f.coords(lat, lon)), lat, lon }, false)}
          />
        </Suspense>
        {intro && <Intro onStart={() => { closeIntro(); if (ranked[0]) openScene(ranked[0].scene.id); }} onClose={closeIntro} />}
      </main>

      <header className="hud">
        <div className="brand"><h1>Nexxus</h1><p>{t.cover.tagline}</p></div>
        <PlaceSearch onPick={(p) => choosePlace(p, true)} />
        <div className="hud__right">
          {API_MODE === "mock" && <p className="badge" title={t.badge.exampleTitle}>{t.badge.example}</p>}
          <button type="button" className="ghost ghost--lab" aria-pressed={lab !== null} onClick={() => (lab ? closeLab() : openLab("hydro"))}>{t.lab.open}</button>
          <button type="button" className="ghost" aria-pressed={intro} onClick={() => (intro ? closeIntro() : setIntro(true))}>{t.cover.about}</button>
          <div className="lang" role="group" aria-label={t.language}>
            {LANGS.map((l) => (
              <button key={l.id} type="button" aria-pressed={lang === l.id} onClick={() => setLang(l.id)}>{l.label}</button>
            ))}
          </div>
        </div>
      </header>

      {ranked.length > 0 && (
        <SceneIndex ranked={ranked} selectedId={selectedId} hoverId={hoverId} onSelect={openScene} onHover={setHoverId} />
      )}

      {/* painel de vidro: a cena aberta, o lugar escolhido ou a conversa, no nível de detalhe escolhido no rodapé */}
      <aside className="story glass">
        <div className="tabs" role="tablist" aria-label={t.tabs.aria}>
          {/* a aba do lugar só existe depois que alguém escolhe um lugar, pela busca ou no mapa */}
          {TABS.filter((id) => id !== "passes" || place !== null || tab === "passes").map((id) => (
            <button key={id} type="button" role="tab" id={`tab-${id}`} aria-selected={tab === id} aria-controls="panel" onClick={() => setTab(id)}>
              {t.tabs[id]}
              {id === "passes" && passesQuery.data && passesQuery.data.length > 0 && <span>{passesQuery.data.length}</span>}
              {id === "ask" && chat.turns.length > 0 && <span>{chat.turns.length}</span>}
            </button>
          ))}
        </div>
        <div className="panel" key={tab} id="panel" role="tabpanel" aria-labelledby={`tab-${tab}`}>
          {tab === "scenes" && (
            scenesQuery.isPending ? <p className="muted">{t.scenes.loading}</p>
            : scenesQuery.isError ? (
              <div className="stack stack--tight">
                <p className="muted">{t.scenes.error}</p>
                <button type="button" className="link" onClick={() => scenesQuery.refetch()}>{t.scenes.retry}</button>
              </div>
            ) : (
              <SceneSheet audience={audience} ranked={ranked} selectedId={selectedId} picked={picked}
                view={view} analysis={analysis} onTogglePick={togglePick} onView={(v) => map.current?.setView(v)} onLab={openLab}
                onPlay={() => map.current?.play()} onPol={(p) => map.current?.setPol(p)} onSensitivity={(v) => map.current?.setSensitivity(v)} />
            )
          )}
          {tab === "passes" && (
            <PassesPanel place={place} audience={audience} passes={passesQuery.data} loading={passesQuery.isFetching && !passesQuery.data}
              failed={passesQuery.isError} example={API_MODE === "mock" ? "mock" : passesQuery.data?.some((p) => p.isExample) ? "fallback" : null} scenes={scenes}
              onRetry={() => passesQuery.refetch()} onOpenScene={openScene} />
          )}
          {tab === "ask" && <AskPanel chat={chat} scenes={scenes} context={context} suggestions={t.ask.suggestions[audience]} onOpenScene={openScene} />}
        </div>
        <footer className="depth">
          <span id="depth-label">{t.aud.label}</span>
          <div className="pills" role="group" aria-labelledby="depth-label">
            {AUDIENCES.map((x) => (
              <button key={x} type="button" aria-pressed={audience === x} title={t.aud.hint[x]} onClick={() => setAudience(x)}>{t.aud[x]}</button>
            ))}
          </div>
        </footer>
      </aside>

      {LINK.perf && <PerfPanel />}
      {lab && (
        <Suspense fallback={<section className="lab glass" role="dialog" aria-label={t.lab.aria}><p className="map__status">{t.scenes.loading}</p></section>}>
          <Lab panel={lab} scene={hydroScene} loading={scenesQuery.isPending} failed={scenesQuery.isError} onRetry={() => scenesQuery.refetch()} onPanel={setLab} onClose={closeLab} />
        </Suspense>
      )}
    </div>
  );
}
