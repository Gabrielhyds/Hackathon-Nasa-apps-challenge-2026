import { Fragment, Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from "react";
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
import { trackFor } from "./lib/soundtrack";
import { useChat } from "./lib/useChat";
import { useSoundtrack } from "./lib/useSoundtrack";
import logo from "./assets/brand/nexxus.webp";
import { useSpeech } from "./lib/useSpeech";
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

/** Ícone de cada aba no trilho da folha recolhida. */
function TabIcon({ id }: { id: Tab | "lab" }) {
  const line = { fill: "none", stroke: "currentColor", strokeWidth: 1.5, strokeLinecap: "round", strokeLinejoin: "round" } as const;
  return (
    <svg viewBox="0 0 20 20" width="20" height="20" aria-hidden="true">
      {id === "scenes" && <path {...line} d="M10 3 2.5 7 10 11l7.5-4zM2.5 10.5 10 14.5l7.5-4M2.5 14 10 18l7.5-4" />}
      {id === "passes" && <><path {...line} d="M10 18s5.5-5.2 5.5-9.5a5.5 5.5 0 0 0-11 0C4.5 12.8 10 18 10 18z" /><circle {...line} cx="10" cy="8.5" r="2" /></>}
      {id === "lab" && <path {...line} d="M7.5 2.5h5M8.5 2.5v5L4 15.5a1.5 1.5 0 0 0 1.3 2.2h9.4a1.5 1.5 0 0 0 1.3-2.2L11.5 7.5v-5M6.3 12.5h7.4" />}
      {id === "ask" && <path {...line} d="M3 5.5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v6.5a2 2 0 0 1-2 2H9l-4 3.5V14a2 2 0 0 1-2-2z" />}
    </svg>
  );
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
  /** Muda quando o lugar é retirado: a busca recomeça vazia. */
  const [searchReset, setSearchReset] = useState(0);
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
  /** A folha recolhida: no lugar dela fica um trilho de ícones, um por aba, e o mapa ganha a largura. */
  const [folded, setFolded] = useState(false);
  // quem chega por um link para uma cena ou lugar vai direto para lá, sem a abertura
  const [intro, setIntro] = useState(() => firstVisit() && !DEEP_LINK);
  // o agente responde sobre a cena aberta e as marcadas para comparar
  const context = useMemo(() => [...new Set([selectedId, ...picked].filter((id): id is string => Boolean(id)))], [selectedId, picked]);
  const chat = useChat(context, lang);
  // trilha de fundo: uma faixa para explorar e outra para os dados, com transição entre elas
  const speech = useSpeech();
  const sound = useSoundtrack(trackFor({ intro, tab, audience, lab, opened, view }), speech.speaking !== null);

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
    setFolded(false);
    setLab(null);
    setTab("scenes");
    move((m) => m.flyToScene(scene));
    requestAnimationFrame(() => document.querySelector(`[data-scene="${id}"]`)?.scrollIntoView({ block: "nearest" }));
  }
  function choosePlace(next: Place, fly: boolean) {
    if (intro) closeIntro();
    setPlace(next);
    setFolded(false);
    setLab(null);
    setTab("passes");
    if (fly) move((m) => m.flyToPlace(next));
  }
  /** Tira o lugar escolhido: o ponto e as faixas saem do mapa, a aba do lugar some e a busca esvazia. */
  function clearPlace() {
    setPlace(null);
    if (tab === "passes") setTab("scenes");
    setSearchReset((n) => n + 1);
  }
  // o hidrograma é da cena aberta, se ela tiver um; senão, da primeira que tiver
  const hydroScene = scenes.find((s) => s.id === selectedId && s.waterSeries) ?? scenes.find((s) => s.waterSeries);
  function openLab(panel: LabId) {
    if (intro) closeIntro();
    setFolded(false);
    setLab(panel);
  }
  const togglePick = (id: string) => {
    setPickedByUser(true);
    setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id].slice(-3)));
  };

  // a aba do laboratório vem logo antes da conversa: depois do lugar, se ele estiver na fileira; senão, depois da cena
  // a aba do lugar só existe depois que alguém escolhe um lugar, pela busca ou no mapa
  const visibleTabs = TABS.filter((id) => id !== "passes" || place !== null || tab === "passes");
  const beforeLab: Tab = place !== null || tab === "passes" ? "passes" : "scenes";

  return (
    <div className={[intro ? "app app--intro" : "app", folded ? "app--rail" : lab ? "app--lab" : ""].join(" ").trim()} data-aud={audience}>
      <main className="stage">
        <Suspense fallback={<div className="map"><p className="map__status">{t.map.loading}</p></div>}>
          <MapView
            ref={attachMap}
            audience={audience}
            labOpen={lab !== null}
            sideFolded={folded}
            scenes={scenes}
            selectedId={selectedId}
            titledId={tab === "scenes" && lab === null ? selectedId : null}
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
        <div className="brand"><h1><img src={logo} alt="Nexxus" width={1120} height={291} /></h1><p>{t.cover.tagline}</p></div>
        <PlaceSearch key={searchReset} onPick={(p) => choosePlace(p, true)} />
        <div className="hud__right">
          {API_MODE === "mock" && <p className="badge" title={t.badge.exampleTitle}>{t.badge.example}</p>}
          <a className="ghost repo" href="https://github.com/Gabrielhyds/Hackathon-Nasa-apps-challenge-2026" target="_blank" rel="noreferrer" aria-label={t.cover.repo} title={t.cover.repo}>
            <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
              <path fill="currentColor" d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27s1.36.09 2 .27c1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8z" />
            </svg>
          </a>
          <button type="button" className="ghost" aria-pressed={intro} onClick={() => (intro ? closeIntro() : setIntro(true))}>{t.cover.about}</button>
          <button type="button" className="ghost sound" aria-pressed={sound.on && !sound.failed} title={sound.failed ? t.sound.failed : sound.on ? t.sound.on : t.sound.off} onClick={sound.toggle}>
            <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
              <path d="M2 6h2.5L8 3v10L4.5 10H2z" fill="currentColor" />
              {sound.on && !sound.failed
                ? <path d="M10.5 5.5a3.5 3.5 0 0 1 0 5M12.5 3.5a6.5 6.5 0 0 1 0 9" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
                : <path d="M10.5 6l4 4M14.5 6l-4 4" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />}
            </svg>
            {t.sound.label}
          </button>
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
      {folded ? (
      <aside className="story story--rail glass">
        {/* folha recolhida: cada aba vira um ícone, que reabre a folha nela */}
        <nav className="rail" aria-label={t.tabs.aria}>
          {visibleTabs.map((id) => (
            <Fragment key={id}>
              <button type="button" aria-label={t.tabs[id]} title={t.tabs[id]} aria-current={lab === null && tab === id ? "true" : undefined} onClick={() => { setFolded(false); closeLab(); setTab(id); }}>
                <TabIcon id={id} />
                {id === "ask" && chat.turns.length > 0 && <span>{chat.turns.length}</span>}
              </button>
              {id !== "ask" && id === beforeLab && (
                <button type="button" aria-label={t.lab.open} title={t.lab.open} aria-current={lab !== null ? "true" : undefined} onClick={() => openLab(lab ?? "hydro")}><TabIcon id="lab" /></button>
              )}
            </Fragment>
          ))}
        </nav>
      </aside>
      ) : (
      <aside className="story glass">
        <div className="story__head">
        <div className="tabs" role="tablist" aria-label={t.tabs.aria}>
          {visibleTabs.map((id) => (
            <Fragment key={id}>
              <div className={id === "passes" && place ? "tabs__item tabs__item--closable" : "tabs__item"}>
                <button type="button" role="tab" id={`tab-${id}`} aria-selected={lab === null && tab === id} aria-controls="panel" onClick={() => { closeLab(); setTab(id); }}>
                  {t.tabs[id]}
                  {id === "ask" && chat.turns.length > 0 && <span>{chat.turns.length}</span>}
                </button>
                {/* fechar a aba do lugar tira o lugar: o ponto e as faixas saem do mapa */}
                {id === "passes" && place && <button type="button" className="tabs__close" aria-label={t.passes.clear} title={t.passes.clear} onClick={clearPlace}>×</button>}
              </div>
              {/* o laboratório é uma aba como as outras, antes da conversa: aberta, a folha alarga */}
              {id !== "ask" && id === beforeLab && (
                <button type="button" role="tab" id="tab-lab" aria-selected={lab !== null} aria-controls="lab-panel" onClick={() => { if (!lab) openLab("hydro"); }}>{t.lab.open}</button>
              )}
            </Fragment>
          ))}
        </div>
        <button type="button" className="story__fold" aria-label={t.tabs.fold} title={t.tabs.fold} onClick={() => setFolded(true)}>
          <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path d="M6 3.5 10.5 8 6 12.5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></svg>
        </button>
        </div>
        {lab ? (
          <Suspense fallback={<div className="lab" id="lab-panel" role="tabpanel" aria-labelledby="tab-lab"><p className="muted lab__wait">{t.scenes.loading}</p></div>}>
            <Lab panel={lab} scene={hydroScene} loading={scenesQuery.isPending} failed={scenesQuery.isError} onRetry={() => scenesQuery.refetch()} onPanel={setLab} onClose={closeLab}
              onPass={(date) => { if (hydroScene) map.current?.showPass(hydroScene, date); }} />
          </Suspense>
        ) : (<>
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
          {tab === "ask" && <AskPanel chat={chat} speech={speech} scenes={scenes} context={context} suggestions={t.ask.suggestions[audience]} onOpenScene={openScene} />}
        </div>
        <footer className="depth">
          <span id="depth-label">{t.aud.label}</span>
          <div className="pills" role="group" aria-labelledby="depth-label">
            {AUDIENCES.map((x) => (
              <button key={x} type="button" aria-pressed={audience === x} title={t.aud.hint[x]} onClick={() => setAudience(x)}>{t.aud[x]}</button>
            ))}
          </div>
        </footer>
        </>)}
      </aside>
      )}

      {LINK.perf && <PerfPanel />}
    </div>
  );
}
