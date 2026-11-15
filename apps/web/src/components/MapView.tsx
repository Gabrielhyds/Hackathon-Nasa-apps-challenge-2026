import { forwardRef, useEffect, useImperativeHandle, useRef, useState, type CSSProperties } from "react";
import maplibregl, { type CanvasSource, type GeoJSONSource, type Map as GlMap, type Marker, type StyleSpecification } from "maplibre-gl";
import { mesh } from "topojson-client";
import type { GeometryCollection } from "topojson-specification";
import type { Pass, Place, Polarization, Scene } from "@nexxus/contract";
import { useI18n } from "../i18n";
import { changeHistogram, negligibleArea, thresholdTable, type MapAnalysis } from "../lib/analysis";
import { ALMOST_NOTHING, DEFAULT_SENSITIVITY, changeMap, changedParts, ratioFor } from "../lib/change";
import { bboxAreaKm2, swath } from "../lib/geo";
import { compareArea } from "../lib/scale";
import { clamp01, easeInOut, easeOut, reduceMotion } from "../lib/motion";
import { recordSinceStart, stopwatch, timed } from "../lib/perf";
import type { Audience } from "../lib/audience";
import { clampSteps, daysBetween, fullRange, isInterferogram, pairs, pickStep, polarizationFor, walk, type Steps } from "../lib/series";
import { syntheticSeries, type Outline } from "../lib/speckle";
import { grayToDb, meanGray, pixelUnder, type Reading } from "../lib/probe";
import { corners, hasOptical, opticalFrame, opticalImage } from "../lib/optical";
import { releases } from "../lib/provenance";
import { cloudSource, imagerySources, latestCloudDay } from "../lib/tiles";

export interface MapHandle {
  flyToScene(scene: Scene): void;
  flyToPlace(place: Place): void;
  /** Troca entre antes/depois, o mapa de mudança e a imagem óptica do dia, a pedido da folha. */
  setView(view: "swipe" | "change" | "optical"): void;
  /** A pedido da folha: toca a série, troca a polarização e muda o limiar do mapa de mudança (sensibilidade de 0 a 1). */
  play(): void;
  setPol(pol: Polarization): void;
  setSensitivity(value: number): void;
  /** A pedido da régua de cheia: mostra inteira no mapa a passagem dessa data, se a cena a tiver na série. */
  showPass(scene: Scene, date: string): void;
  reset(): void;
}

interface Props {
  /** Quem está lendo: decide quais controles aparecem no console. */
  audience: Audience;
  scenes: Scene[];
  selectedId: string | null;
  /** Cena sob o ponteiro, no mapa ou na lista. Ganha rótulo e um eco branco. */
  hoverId: string | null;
  place: Place | null;
  /** Passagens do lugar escolhido. Servem para desenhar as faixas da órbita. */
  passes: Pass[] | undefined;
  onSelectScene(id: string): void;
  onHoverScene(id: string | null): void;
  onPickPoint(lat: number, lon: number): void;
  /** Modo da imagem de radar ao abrir (vem do endereço da página) e aviso quando o usuário troca. */
  initialView?: Mode;
  onViewChange?(view: Mode): void;
  /** Polarização ao abrir (do endereço) e aviso quando o usuário troca. */
  initialPol?: Polarization;
  /** Par de passagens pedido pelo endereço para a cena `linkedScene`. */
  initialSteps?: Steps;
  linkedScene?: string;
  /** Polarização escolhida e par comparado na cena em foco (`undefined` quando é primeira contra última). */
  onSeriesChange?(state: { pol: Polarization; sceneId: string | null; steps: Steps | undefined }): void;
  /** Medidas do par em tela na cena em foco, para a folha. `null`: sem cena de perto, interferograma ou imagem ilegível. */
  onAnalysis?(analysis: MapAnalysis | null): void;
  /** O usuário voltou para a visão do mundo inteiro. */
  onHome?(): void;
  /** O laboratório está aberto: um painel largo cobre a direita no lugar da folha, e o centro útil do mapa vai mais para a esquerda. */
  labOpen?: boolean;
}

/** Cores desenhadas no mapa. Espelham os tokens de styles.css; o mapa não lê variáveis CSS. */
const C = { ink: "#FFFFFF", red: "#FFB020", blue: "#5CE1FF" };
/** No mapa de mudança: onde o sinal caiu (--amber) e onde subiu (--ice), em RGB. */
const FELL = [255, 176, 32], ROSE = [92, 225, 255];
/** Ampliação em que a cena deixa de ser um ponto e vira imagem de radar. */
const NEAR_FROM = 4.4, NEAR_FULL = 5.4;
/** Altura reservada na base do mapa para o player e o carrossel de cenas, em pixels. */
const SWIPE_BOX = 290;
/** Largura do painel de vidro mais a margem, em pixels. Espelha --story e --gap de styles.css. */
const SHEET = 432;
/** Largura do painel do laboratório em tela larga. Espelha `--lab-panel` de styles.css: min(60vw, 960px). */
const labPanelWidth = (viewport: number) => Math.min(viewport * 0.6, 960);
/** Tempo para a faixa da órbita atravessar o lugar escolhido. */
const BAND_MS = 1100;
/** Lado, em pixels, da imagem de radar de cada cena desenhada no mapa. */
const TILE = 512;
/** Lado da grade em que o mapa de mudança é calculado. Menor que a imagem: a redução já tira parte do ruído. */
const GRID = 128;
/** "optical": a imagem óptica do dia do evento em volta da cena, e o radar dentro da moldura. Só em cena que a tem. */
type Mode = "swipe" | "change" | "optical";
/** A cena tem imagem óptica do dia do evento para pôr em volta do radar? */
const optical = (scene: Scene) => !isInterferogram(scene) && hasOptical(scene);
/** Tempo para a nuvem aparecer e sumir, e para o mapa se afastar ou voltar. */
const OPTICAL_FADE = 700, OPTICAL_FLY = 1600;
/** Onde o globo começa: Atlântico Sul, com a América do Sul à vista. */
const HOME: [number, number] = [-38, -12];
/** Giro do globo parado, em graus por milissegundo. */
const SPIN = 0.0035;

/** Imagens de uma cena numa polarização: uma por passagem. `outlines` só existe no exemplo sintético. */
interface Imagery { frames: CanvasImageSource[]; outlines: (Outline | null)[] | null }
interface Pin { marker: Marker; el: HTMLButtonElement; label: HTMLElement }

/** Ampliação em que o globo ocupa boa parte do espaço disponível. */
const homeZoom = (w: number, h: number) => Math.log2((0.92 * Math.min(w, h) * Math.PI) / 512);
const sceneCorners = (s: Scene): [[number, number], [number, number], [number, number], [number, number]] =>
  [[s.bbox[0], s.bbox[3]], [s.bbox[2], s.bbox[3]], [s.bbox[2], s.bbox[1]], [s.bbox[0], s.bbox[1]]];

export const MapView = forwardRef<MapHandle, Props>(function MapView(props, ref) {
  const boxRef = useRef<HTMLDivElement>(null);
  const { t, f } = useI18n();
  const live = useRef({ ...props, t, f });
  live.current = { ...props, t, f };

  /** O laboratório está aberto agora; lido na criação do mapa, que acontece uma vez só. */
  const labRef = useRef(props.labOpen ?? false);
  labRef.current = props.labOpen ?? false;
  /** Quanto da direita do mapa está coberto: a folha normal ou o painel largo do laboratório. */
  const sideWidth = () => (labRef.current ? labPanelWidth(window.innerWidth) + 32 : SHEET);
  /** Para onde o giro inicial leva a margem e o zoom, aos poucos. O giro reposiciona o mapa a cada quadro e cancelaria uma animação comum. */
  const spinTarget = useRef<{ right: number; zoom: number } | null>(null);
  const mapRef = useRef<GlMap | null>(null);
  const pins = useRef(new Map<string, Pin>());
  const spot = useRef<{ marker: Marker; label: HTMLElement } | null>(null);
  const imagery = useRef(new Map<string, Imagery>());
  const canvases = useRef(new Map<string, HTMLCanvasElement>());
  const dividerRef = useRef(0.5);
  /** Mudança por pixel de cada cena, calculada uma vez. `null`: as imagens não puderam ser lidas. */
  const changes = useRef(new Map<string, Float32Array | null>());
  /** Cinza de cada imagem real, para a leitura em dB sob o ponteiro. `null`: a imagem não pôde ser lida. */
  const grays = useRef(new Map<string, Uint8Array | null>());
  const probeRaf = useRef(0);
  /** Cenas de interferograma cuja imagem de fase não carregou: não há exemplo que a substitua, a tela avisa. */
  const phaseFailed = useRef(new Set<string>());
  /** Cenas cuja imagem óptica já foi pedida. */
  const clouded = useRef(new Set<string>());
  const modeRef = useRef<Mode>(props.initialView ?? "swipe");
  /** Movimentos pedidos antes de o mapa terminar de carregar. Rodam assim que ele fica pronto. */
  const pending = useRef<(() => void)[]>([]);
  const readyRef = useRef(false);
  const whenReady = (run: () => void) => { if (readyRef.current) run(); else pending.current.push(run); };
  const ratioRef = useRef(ratioFor(DEFAULT_SENSITIVITY));
  const polRef = useRef<Polarization>(props.initialPol ?? "HH");
  /** Par comparado em cada cena. Sem entrada: primeira contra última. */
  const stepsOf = useRef(new Map<string, Steps>(props.initialSteps && props.linkedScene ? [[props.linkedScene, props.initialSteps]] : []));
  /** Par que estava escolhido quando a animação começou; volta a ele se ela for interrompida. */
  /** Cena em foco (a que tem divisor), lida fora do ciclo do React. */
  const nearIdRef = useRef<string | null>(null);
  const walkRange = useRef<{ id: string; steps: Steps } | null>(null);
  const spinning = useRef(false);
  const swipeRaf = useRef(0);
  const bandRaf = useRef(0);

  const [divider, setDivider] = useState(0.5);
  const [mode, setMode] = useState<Mode>(props.initialView ?? "swipe");
  const [sensitivity, setSensitivity] = useState(DEFAULT_SENSITIVITY);
  const [pol, setPol] = useState<Polarization>(props.initialPol ?? "HH");
  /** Sobe quando o par de alguma cena muda, para a linha do tempo redesenhar. */
  const [stepsVersion, setStepsVersion] = useState(0);
  /** Sobe quando imagens reais terminam de carregar, para refazer as contas que dependem delas. */
  const [imageVersion, setImageVersion] = useState(0);
  const [nearScene, setNearScene] = useState<Scene | null>(null);
  const [near, setNear] = useState(false);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  /** Nuvens de agora: desligado, buscando, falhou, ou a hora (ISO) da imagem que está no mapa. */
  const [clouds, setClouds] = useState(false);
  const [liveTime, setLiveTime] = useState<string | null>(null);
  const [liveFailed, setLiveFailed] = useState(false);
  /** Sinal sob o ponteiro na cena em foco, nas duas passagens do par. Só no dado calibrado. */
  const [probe, setProbe] = useState<{ before: Reading; after: Reading } | null>(null);
  /** Dicas do globo, cada uma perto do que descreve: a de arrastar some no primeiro arrasto; a de clicar segue o ponteiro até o primeiro clique. */
  const [dragHint, setDragHint] = useState(true);
  const [clickHint, setClickHint] = useState(true);
  const tipRef = useRef<HTMLSpanElement>(null);
  const [ripple, setRipple] = useState<{ x: number; y: number; id: number } | null>(null);

  // ---------- imagens de radar de cada cena ----------
  const stepsFor = (scene: Scene): Steps =>
    clampSteps(stepsOf.current.get(scene.id) ?? fullRange(scene.acquisitions.length), scene.acquisitions.length);

  function imageryFor(scene: Scene, p: Polarization): Imagery {
    const key = `${scene.id}|${p}`;
    const cached = imagery.current.get(key);
    if (cached) return cached;
    const phase = isInterferogram(scene);
    // imagem de fase não tem exemplo: enquanto não chega (ou se não chegar), a cena fica vazia, com a moldura
    const blank = () => { const c = document.createElement("canvas"); c.width = c.height = 2; return c; };
    const { frames, outlines } = phase ? { frames: scene.acquisitions.map(blank), outlines: null } : syntheticSeries(scene.id, scene.change, p, scene.acquisitions.length);
    const entry: Imagery = { frames, outlines };
    const failPhase = () => { if (phase) { phaseFailed.current.add(scene.id); setImageVersion((v) => v + 1); } };
    imagery.current.set(key, entry);
    // Com imagens reais em todas as passagens, elas substituem o exemplo assim que carregam.
    const urls = scene.acquisitions.map((a) => a.images[p]);
    if (urls.every((u): u is string => Boolean(u))) {
      const load = (url: string) => new Promise<HTMLImageElement>((ok, fail) => {
        const img = new Image();
        img.crossOrigin = "anonymous";
        img.onload = () => ok(img);
        img.onerror = fail;
        img.src = url;
      });
      const loadedIn = stopwatch("radar");
      Promise.all(urls.map(load))
        .then((loaded) => {
          loadedIn();
          imagery.current.set(key, { frames: loaded, outlines: null });
          for (const k of [...changes.current.keys()]) if (k.startsWith(`${key}|`)) changes.current.delete(k);
          for (const k of [...grays.current.keys()]) if (k.startsWith(`${key}|`)) grays.current.delete(k);
          setImageVersion((v) => v + 1);
          paintScene(scene);
        })
        .catch(() => { failPhase(); /* nas outras cenas, fica o exemplo sintético */ });
    } else failPhase();
    return entry;
  }

  /** Quanto cada pixel da cena mudou entre as duas passagens do par. Lê as imagens numa grade pequena e guarda o resultado. */
  function changeFor(scene: Scene, p: Polarization, [from, to]: Steps): Float32Array | null {
    const key = `${scene.id}|${p}|${from}|${to}`;
    const cached = changes.current.get(key);
    if (cached !== undefined) return cached;
    const img = imageryFor(scene, p);
    const read = (source: CanvasImageSource): Float32Array => {
      const c = document.createElement("canvas");
      c.width = c.height = GRID;
      const g = c.getContext("2d", { willReadFrequently: true })!;
      g.drawImage(source, 0, 0, GRID, GRID);
      const px = g.getImageData(0, 0, GRID, GRID).data;
      return Float32Array.from({ length: GRID * GRID }, (_, i) => (px[i * 4] + px[i * 4 + 1] + px[i * 4 + 2]) / 765);
    };
    let result: Float32Array | null = null;
    // só o dado calibrado tem a mesma escala nas duas datas; preview e exemplo descontam a mediana
    const calibrated = scene.imagery === "gcov" && img.outlines === null;
    try { result = timed("change", () => changeMap(read(img.frames[from]), read(img.frames[to]), GRID, 2, calibrated)); } catch { /* imagem de outro servidor sem CORS: não dá para ler */ }
    changes.current.set(key, result);
    return result;
  }

  /** O dB que vira branco nesta cena e polarização, quando a imagem na tela é a calibrada de verdade. */
  function topDbFor(scene: Scene, p: Polarization): number | null {
    const top = scene.imageryDetails?.topDb?.[p];
    return scene.imagery === "gcov" && typeof top === "number" && imageryFor(scene, p).outlines === null && scene.acquisitions.every((a) => a.images[p]) ? top : null;
  }

  /** Cinza de uma passagem da cena, lido uma vez na resolução em que ela é desenhada. */
  function grayFor(scene: Scene, p: Polarization, k: number): Uint8Array | null {
    const key = `${scene.id}|${p}|${k}`;
    const cached = grays.current.get(key);
    if (cached !== undefined) return cached;
    let result: Uint8Array | null = null;
    try {
      const c = document.createElement("canvas");
      c.width = c.height = TILE;
      const g = c.getContext("2d", { willReadFrequently: true })!;
      g.drawImage(imageryFor(scene, p).frames[k], 0, 0, TILE, TILE);
      const px = g.getImageData(0, 0, TILE, TILE).data;
      result = Uint8Array.from({ length: TILE * TILE }, (_, i) => px[i * 4]);
    } catch { /* imagem de outro servidor sem CORS: não dá para ler */ }
    grays.current.set(key, result);
    return result;
  }

  /** Lê o sinal das duas passagens do par sob um ponto do mapa. `null` fora da cena em foco ou sem dado calibrado. */
  function readProbe(lon: number, lat: number): { before: Reading; after: Reading } | null {
    const scene = live.current.scenes.find((s) => s.id === nearIdRef.current);
    if (!scene) return null;
    const p = polarizationFor(scene, polRef.current), top = topDbFor(scene, p), at = pixelUnder(scene.bbox, lon, lat, TILE);
    if (top === null || !at) return null;
    const [from, to] = stepsFor(scene), a = grayFor(scene, p, from), b = grayFor(scene, p, to);
    if (!a || !b) return null;
    return { before: grayToDb(meanGray(a, TILE, at.x, at.y), top), after: grayToDb(meanGray(b, TILE, at.x, at.y), top) };
  }

  /** Desenha a cena no canvas dela: a passagem de antes à esquerda do divisor, a de depois à direita, e o contorno da área alterada. */
  function paintScene(scene: Scene) {
    const map = mapRef.current, canvas = canvases.current.get(scene.id), ctx = canvas?.getContext("2d");
    if (!map || !canvas || !ctx) return;
    const p = polarizationFor(scene, polRef.current), steps = stepsFor(scene), [from, to] = steps;
    const img = imageryFor(scene, p), S = TILE;
    // só a cena em foco tem divisor; as outras mostram a passagem mais recente do par
    const d = scene.id === nearIdRef.current ? dividerRef.current : 0;
    ctx.clearRect(0, 0, S, S);
    if (modeRef.current === "optical" && scene.id === nearIdRef.current && optical(scene)) {
      // modo óptico: à esquerda do divisor o canvas fica vazio e aparece a nuvem, que é uma camada do mapa por baixo;
      // à direita, a passagem de radar de depois
      ctx.save(); ctx.beginPath(); ctx.rect(S * d, 0, S * (1 - d), S); ctx.clip(); ctx.drawImage(img.frames[to], 0, 0, S, S); ctx.restore();
      if (d > 0 && d < 1) { ctx.fillStyle = C.ink; ctx.fillRect(S * d - 1.5, 0, 3, S); }
      const source = map.getSource<CanvasSource>(`scene-${scene.id}`);
      if (source) { source.play(); map.once("render", () => source.pause()); map.triggerRepaint(); }
      return;
    }
    ctx.drawImage(img.frames[to], 0, 0, S, S);
    // fase não é brilho: não há mapa de mudança, mesmo que o endereço peça
    const change = modeRef.current === "change" && !isInterferogram(scene) ? changeFor(scene, p, steps) : null;
    if (change) {
      // modo "o que mudou": a passagem de depois, com âmbar onde o sinal caiu além do limiar e azul-gelo onde subiu
      const mask = document.createElement("canvas");
      mask.width = mask.height = GRID;
      const g = mask.getContext("2d")!, data = g.createImageData(GRID, GRID), limit = Math.log(ratioRef.current);
      for (let i = 0; i < change.length; i++) {
        if (Math.abs(change[i]) <= limit) continue;
        const rgb = change[i] < 0 ? FELL : ROSE;
        // a subida costuma cobrir áreas grandes (solo molhado, estação): mais transparente, para a imagem aparecer por baixo
        data.data[i * 4] = rgb[0]; data.data[i * 4 + 1] = rgb[1]; data.data[i * 4 + 2] = rgb[2]; data.data[i * 4 + 3] = change[i] < 0 ? 200 : 120;
      }
      g.putImageData(data, 0, 0);
      ctx.drawImage(mask, 0, 0, S, S);
      const source = map.getSource<CanvasSource>(`scene-${scene.id}`);
      if (source) { source.play(); map.once("render", () => source.pause()); map.triggerRepaint(); }
      return;
    }
    ctx.save(); ctx.beginPath(); ctx.rect(0, 0, S * d, S); ctx.clip(); ctx.drawImage(img.frames[from], 0, 0, S, S); ctx.restore();
    const o = img.outlines?.[to];
    if (o) {
      ctx.save(); ctx.beginPath(); ctx.rect(S * d, 0, S * (1 - d), S); ctx.clip();
      ctx.strokeStyle = C.red; ctx.lineWidth = 3; ctx.setLineDash([9, 7]);
      ctx.beginPath(); ctx.ellipse(o.cx * S, o.cy * S, o.rx * S * 1.12, o.ry * S * 1.25, 0, 0, Math.PI * 2); ctx.stroke();
      ctx.restore();
    }
    if (d > 0) { ctx.fillStyle = C.ink; ctx.fillRect(S * d - 1.5, 0, 3, S); }
    // o mapa só relê o canvas enquanto a fonte está "tocando": toca por um quadro
    const source = map.getSource<CanvasSource>(`scene-${scene.id}`);
    if (source) { source.play(); map.once("render", () => source.pause()); map.triggerRepaint(); }
  }

  // ---------- montagem do mapa ----------
  useEffect(() => {
    const box = boxRef.current;
    if (!box) return;
    const { base, detail } = imagerySources();
    const style: StyleSpecification = {
      version: 8,
      projection: { type: "globe" },
      // brilho azulado na borda do globo, que some ao chegar perto
      sky: { "atmosphere-blend": ["interpolate", ["linear"], ["zoom"], 0, 1, 4, 1, 6, 0] },
      sources: { base, detail },
      layers: [
        { id: "base", type: "raster", source: "base", paint: { "raster-fade-duration": 250, "raster-saturation": -0.15, "raster-brightness-max": 0.92 } },
        { id: "detail", type: "raster", source: "detail", minzoom: 8, paint: { "raster-opacity": ["interpolate", ["linear"], ["zoom"], 8, 0, 9, 1] } },
      ],
    };
    let map: GlMap;
    try {
      const size = box.getBoundingClientRect();
      map = new maplibregl.Map({
        container: box, style, center: HOME, zoom: homeZoom(size.width - (size.width > 900 ? sideWidth() : 0), size.height - 220), minZoom: 0.6, maxZoom: 16,
        attributionControl: false, dragRotate: false, pitchWithRotate: false, touchPitch: false, renderWorldCopies: false,
      });
    } catch {
      setFailed(true);
      return;
    }
    mapRef.current = map;
    map.touchZoomRotate.disableRotation();
    map.addControl(new maplibregl.AttributionControl({ compact: true }), "bottom-left");
    // em tela larga a folha cobre a direita do mapa: o centro útil fica deslocado para a esquerda
    const narrow = window.matchMedia("(max-width: 900px)");
    const fit = () => map.setPadding(narrow.matches ? { top: 0, right: 0, bottom: 0, left: 0 } : { top: 64, right: sideWidth(), bottom: 0, left: 0 });
    fit();
    narrow.addEventListener("change", fit);

    // giro lento até a primeira interação
    let last = performance.now(), spinRaf = 0;
    spinning.current = !reduceMotion();
    const spin = (now: number) => {
      if (!spinning.current) return;
      const c = map.getCenter(), center: [number, number] = [c.lng + (now - last) * SPIN, c.lat];
      const target = spinTarget.current;
      if (target) {
        // o laboratório abriu ou fechou durante o giro: margem e zoom chegam ao destino sem parar de girar
        const k = 1 - Math.exp(-(now - last) / 130), right = map.getPadding().right ?? 0, zoom = map.getZoom();
        const done = Math.abs(target.right - right) < 0.5 && Math.abs(target.zoom - zoom) < 0.002;
        map.jumpTo({ center, zoom: done ? target.zoom : zoom + (target.zoom - zoom) * k, padding: { top: 64, right: done ? target.right : right + (target.right - right) * k, bottom: 0, left: 0 } });
        if (done) spinTarget.current = null;
      } else map.jumpTo({ center });
      last = now;
      spinRaf = requestAnimationFrame(spin);
    };
    const stopSpin = () => { spinning.current = false; };
    for (const type of ["pointerdown", "wheel", "touchstart"]) box.addEventListener(type, stopSpin, { passive: true });

    map.on("load", () => {
      recordSinceStart("map");
      map.addSource("swath", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
      map.addLayer({ id: "swath-fill", type: "fill", source: "swath", filter: ["==", ["geometry-type"], "Polygon"], paint: { "fill-color": ["get", "color"], "fill-opacity": ["get", "opacity"] } });
      map.addLayer({ id: "swath-line", type: "line", source: "swath", filter: ["==", ["geometry-type"], "LineString"], paint: { "line-color": ["get", "color"], "line-width": 1, "line-opacity": 0.85, "line-dasharray": [4, 4] } });
      setReady(true);
      readyRef.current = true;
      // espera as cenas ganharem pino e imagem antes de voar até uma delas
      requestAnimationFrame(() => { for (const run of pending.current.splice(0)) run(); });
      if (spinning.current) { last = performance.now(); spinRaf = requestAnimationFrame(spin); }
      // fronteiras: um fio fino sobre a imagem, para dar referência sem competir com ela
      import("world-atlas/countries-50m.json").then((m) => {
        if (mapRef.current !== map) return;
        const topo = m.default;
        map.addSource("borders", { type: "geojson", data: mesh(topo, topo.objects.countries as GeometryCollection, (a, b) => a !== b) });
        map.addLayer({ id: "borders", type: "line", source: "borders", paint: { "line-color": C.ink, "line-width": 0.6, "line-opacity": ["interpolate", ["linear"], ["zoom"], 1, 0.22, 6, 0.4] } }, "swath-fill");
      }).catch(() => { /* sem fronteiras o mapa continua legível */ });
    });

    map.on("move", () => {
      const zoom = map.getZoom(), c = map.getCenter();
      setNear(zoom > (NEAR_FROM + NEAR_FULL) / 2);
      const focus = zoom > NEAR_FULL
        ? live.current.scenes.find((s) => c.lng >= s.bbox[0] - 1 && c.lng <= s.bbox[2] + 1 && c.lat >= s.bbox[1] - 1 && c.lat <= s.bbox[3] + 1) ?? null
        : null;
      nearIdRef.current = focus?.id ?? null;
      setNearScene((prev) => (prev?.id === focus?.id ? prev : focus));
    });
    // leitura em dB sob o ponteiro: no máximo uma por quadro, e só muda a tela quando o valor muda
    map.on("dragstart", () => setDragHint(false));
    map.on("mousemove", (e) => {
      // a dica de clicar acompanha o ponteiro: só na visão do mundo, sobre o globo e sem botão apertado; escrita direto no elemento, sem redesenhar a tela
      const tip = tipRef.current;
      if (tip) {
        const back = map.project(e.lngLat), onGlobe = Math.hypot(back.x - e.point.x, back.y - e.point.y) <= 3;
        const show = onGlobe && e.originalEvent.buttons === 0 && map.getZoom() < 4;
        tip.style.opacity = show ? "1" : "0";
        if (show) tip.style.transform = `translate(${e.point.x + 16}px, ${e.point.y + 18}px)`;
      }
      cancelAnimationFrame(probeRaf.current);
      const { lng, lat } = e.lngLat.wrap();
      probeRaf.current = requestAnimationFrame(() => {
        const next = readProbe(lng, lat);
        setProbe((prev) => (JSON.stringify(prev) === JSON.stringify(next) ? prev : next));
      });
    });
    map.on("mouseout", () => { cancelAnimationFrame(probeRaf.current); setProbe(null); if (tipRef.current) tipRef.current.style.opacity = "0"; });
    map.on("click", (e) => {
      // fora do globo o clique cai num ponto que não volta para o mesmo lugar da tela
      const back = map.project(e.lngLat);
      if (Math.hypot(back.x - e.point.x, back.y - e.point.y) > 3) return;
      setRipple({ x: e.point.x, y: e.point.y, id: Date.now() });
      setClickHint(false);
      live.current.onPickPoint(e.lngLat.lat, e.lngLat.wrap().lng);
      // de longe a faixa da órbita mal aparece: chega mais perto do ponto escolhido
      if (map.getZoom() < 4) map.flyTo({ center: e.lngLat, zoom: 4.6, duration: 1600 });
    });

    return () => {
      cancelAnimationFrame(spinRaf); cancelAnimationFrame(bandRaf.current); cancelAnimationFrame(swipeRaf.current); cancelAnimationFrame(probeRaf.current);
      for (const type of ["pointerdown", "wheel", "touchstart"]) box.removeEventListener(type, stopSpin);
      narrow.removeEventListener("change", fit);
      // a fila de movimentos fica: se o mapa for montado de novo (o React faz isso em desenvolvimento), ela roda no próximo load
      readyRef.current = false;
      pins.current.clear(); canvases.current.clear(); clouded.current.clear(); spot.current = null; mapRef.current = null;
      map.remove();
      setReady(false);
    };
  }, []);

  // ---------- cenas: um pino e uma imagem de radar para cada ----------
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    props.scenes.forEach((scene, i) => {
      let pin = pins.current.get(scene.id);
      if (!pin) {
        const el = document.createElement("button");
        el.type = "button";
        el.className = "pin";
        el.style.setProperty("--i", String(i));
        el.innerHTML = '<i class="pin__ring"></i><i class="pin__ring"></i><i class="pin__dot"></i><b class="pin__label"></b>';
        el.addEventListener("click", (e) => { e.stopPropagation(); live.current.onSelectScene(scene.id); });
        el.addEventListener("mouseenter", () => live.current.onHoverScene(scene.id));
        el.addEventListener("mouseleave", () => live.current.onHoverScene(null));
        const marker = new maplibregl.Marker({ element: el, anchor: "center", opacityWhenCovered: "0" }).setLngLat([scene.lon, scene.lat]).addTo(map);
        pin = { marker, el, label: el.querySelector("b") as HTMLElement };
        pins.current.set(scene.id, pin);
      }
      pin.label.textContent = scene.name;
      pin.el.setAttribute("aria-label", `${scene.name}, ${scene.event}`);

      // imagem óptica do dia do evento: uma camada por baixo do radar da cena, invisível fora do modo óptico. Vai
      // como canvas, igual ao radar: a imagem é carregada por uma tag, que funciona até onde a página não pode usar fetch
      const cloud = optical(scene) ? opticalImage(scene) : null, day = scene.opticalDay;
      if (cloud && day && !clouded.current.has(scene.id)) {
        clouded.current.add(scene.id);
        const img = new Image();
        img.onload = () => {
          if (mapRef.current !== map || map.getSource(`optical-${scene.id}`)) return;
          const canvas = document.createElement("canvas");
          canvas.width = img.naturalWidth; canvas.height = img.naturalHeight;
          canvas.getContext("2d")?.drawImage(img, 0, 0);
          map.addSource(`optical-${scene.id}`, { type: "canvas", canvas, coordinates: corners(day.bbox), animate: false });
          map.addLayer({
            id: `optical-${scene.id}`, type: "raster", source: `optical-${scene.id}`,
            paint: { "raster-fade-duration": 0, "raster-opacity": 0, "raster-opacity-transition": { duration: reduceMotion() ? 0 : OPTICAL_FADE, delay: 0 } },
          }, map.getLayer(`scene-${scene.id}`) ? `scene-${scene.id}` : undefined);
          syncOptical();
        };
        img.onerror = () => { clouded.current.delete(scene.id); };
        img.src = cloud;
      }
      if (!canvases.current.has(scene.id)) {
        const canvas = document.createElement("canvas");
        canvas.width = canvas.height = TILE;
        canvases.current.set(scene.id, canvas);
        map.addSource(`scene-${scene.id}`, { type: "canvas", canvas, coordinates: sceneCorners(scene), animate: false });
        map.addLayer({
          id: `scene-${scene.id}`, type: "raster", source: `scene-${scene.id}`,
          paint: { "raster-fade-duration": 0, "raster-opacity": ["interpolate", ["linear"], ["zoom"], NEAR_FROM, 0, NEAR_FULL, 1] },
        }, map.getLayer("swath-fill") ? "swath-fill" : undefined);
      }
      paintScene(scene);
    });
    // moldura de cada imagem de radar, como linha do mapa para ficar nítida em qualquer ampliação
    const frames = {
      type: "FeatureCollection" as const,
      features: props.scenes.map((s) => ({ type: "Feature" as const, properties: {}, geometry: { type: "LineString" as const, coordinates: [...sceneCorners(s), sceneCorners(s)[0]] } })),
    };
    const source = map.getSource<GeoJSONSource>("frames");
    if (source) source.setData(frames);
    else {
      map.addSource("frames", { type: "geojson", data: frames });
      map.addLayer({ id: "frames-casing", type: "line", source: "frames", paint: { "line-color": "#0A0E16", "line-width": 5, "line-opacity": 0 } });
      map.addLayer({ id: "frames", type: "line", source: "frames", paint: { "line-color": C.ink, "line-width": 1.5, "line-opacity": ["interpolate", ["linear"], ["zoom"], NEAR_FROM, 0, NEAR_FULL, 1] } });
    }
    syncOptical();
  }, [props.scenes, ready]);

  useEffect(() => {
    for (const [id, pin] of pins.current) {
      pin.el.classList.toggle("pin--on", id === props.selectedId);
      pin.el.classList.toggle("pin--hover", id === props.hoverId && id !== props.selectedId);
    }
  }, [props.selectedId, props.hoverId, props.scenes, ready]);

  // ---------- lugar escolhido e faixas da órbita ----------
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    if (!props.place) { spot.current?.marker.remove(); spot.current = null; return; }
    if (!spot.current) {
      const el = document.createElement("div");
      el.className = "spot";
      el.innerHTML = "<i></i><b></b>";
      spot.current = { marker: new maplibregl.Marker({ element: el, anchor: "center", opacityWhenCovered: "0" }).setLngLat([0, 0]).addTo(map), label: el.querySelector("b") as HTMLElement };
    }
    spot.current.marker.setLngLat([props.place.lon, props.place.lat]);
    spot.current.label.textContent = props.place.name;
  }, [props.place, ready]);

  useEffect(() => {
    const map = mapRef.current, place = props.place, passes = props.passes;
    if (!map || !ready) return;
    const source = map.getSource<GeoJSONSource>("swath");
    cancelAnimationFrame(bandRaf.current);
    if (!source || !place || !passes?.length) { source?.setData({ type: "FeatureCollection", features: [] }); return; }
    const here: [number, number] = [place.lon, place.lat];
    const directions = (["ascending", "descending"] as const).filter((d) => passes.some((p) => p.direction === d));
    const start = performance.now(), still = reduceMotion();
    // a faixa entra por um lado e atravessa o lugar, como o satélite passando
    const tick = (now: number) => {
      const p = still ? 1 : clamp01((now - start) / BAND_MS);
      source.setData({
        type: "FeatureCollection",
        features: directions.flatMap((direction) => {
          const s = swath(here, direction, 2800 * easeOut(p)), up = direction === "ascending";
          const properties = { color: up ? C.blue : C.ink, opacity: up ? 0.24 : 0.14 };
          return [
            { type: "Feature" as const, properties, geometry: { type: "Polygon" as const, coordinates: [s.ring] } },
            { type: "Feature" as const, properties, geometry: { type: "LineString" as const, coordinates: s.line } },
          ];
        }),
      });
      if (p < 1) bandRaf.current = requestAnimationFrame(tick);
    };
    bandRaf.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(bandRaf.current);
  }, [props.passes, props.place, ready]);

  // ---------- nuvens do último dia ----------
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    const clear = () => {
      if (map.getLayer("clouds")) map.removeLayer("clouds");
      if (map.getSource("clouds")) map.removeSource("clouds");
    };
    if (!clouds) { clear(); setLiveTime(null); return; }
    const abort = new AbortController();
    let shown: string | null = null;
    // dias cujos tiles falharam no mapa: a próxima busca pula esses e fica com um anterior
    const bad: string[] = [];
    let errors = 0, retry = 0;
    const onError = (e: { sourceId?: string }) => {
      if (e.sourceId !== "clouds" || !shown || bad.includes(shown)) return;
      if (++errors < 3) return;
      bad.push(shown);
      window.clearTimeout(retry);
      retry = window.setTimeout(() => void refresh(), 500);
    };
    map.on("error", onError);
    const refresh = () => latestCloudDay(abort.signal, bad).then((time) => {
      if (time === shown || mapRef.current !== map) return;
      shown = time;
      errors = 0;
      clear();
      map.addSource("clouds", cloudSource(time));
      // logo acima da imagem de satélite e abaixo de todo o resto: na escala das cenas as nuvens continuam, e a imagem
      // de radar aparece por cima delas, que é o argumento do radar. Só bem de perto somem, para o terreno voltar
      const layers = map.getStyle().layers, top = layers.findIndex((l) => l.id === ("detail"));
      map.addLayer({ id: "clouds", type: "raster", source: "clouds", paint: { "raster-fade-duration": 400, "raster-opacity": ["interpolate", ["linear"], ["zoom"], 5, 1, 7, 0.85, 9.5, 0.85, 11, 0] } }, layers[top + 1]?.id);
      setLiveTime(time);
      setLiveFailed(false);
    }).catch(() => { if (!abort.signal.aborted && !shown) { setLiveFailed(true); setClouds(false); } });
    void refresh();
    // a imagem é diária: basta conferir de hora em hora se o dia virou
    const timer = window.setInterval(refresh, 60 * 60_000);
    return () => { abort.abort(); window.clearInterval(timer); window.clearTimeout(retry); map.off("error", onError); };
  }, [clouds, ready]);

  // ---------- divisor antes/depois e série de passagens ----------
  const nearId = nearScene?.id;
  function setSplit(v: number) {
    dividerRef.current = v;
    setDivider(v);
    const scene = live.current.scenes.find((s) => s.id === nearIdRef.current);
    if (scene) paintScene(scene);
  }
  function repaintAll() { for (const scene of live.current.scenes) paintScene(scene); }
  function report(scene: Scene | null) {
    const steps = scene ? stepsFor(scene) : null, full = scene ? fullRange(scene.acquisitions.length) : null;
    live.current.onSeriesChange?.({
      pol: polRef.current, sceneId: scene?.id ?? null,
      steps: steps && full && (steps[0] !== full[0] || steps[1] !== full[1]) ? steps : undefined,
    });
  }
  /** Mostra a nuvem só em volta da cena em foco, e só no modo óptico. */
  function syncOptical() {
    const map = mapRef.current;
    if (!map) return;
    for (const scene of live.current.scenes) {
      if (map.getLayer(`optical-${scene.id}`)) map.setPaintProperty(`optical-${scene.id}`, "raster-opacity", modeRef.current === "optical" && scene.id === nearIdRef.current ? 1 : 0);
    }
    // sobre a nuvem a moldura branca some: ganha um contorno escuro por baixo
    const on = modeRef.current === "optical" && live.current.scenes.some((s) => s.id === nearIdRef.current && optical(s));
    if (map.getLayer("frames-casing")) map.setPaintProperty("frames-casing", "line-opacity", on ? 0.55 : 0);
  }
  /** Enquadra a cena: de perto, acima da caixa do divisor; no modo óptico, de mais longe, com a nuvem em volta. */
  function frameScene(scene: Scene, duration: number) {
    const map = mapRef.current, box = boxRef.current;
    if (!map || !box) return;
    // a imagem fica acima da caixa do divisor, que ocupa a base do mapa (em tela estreita a caixa fica fora dele)
    const reserve = window.matchMedia("(max-width: 900px)").matches ? 150 : box.clientHeight > 560 ? SWIPE_BOX : 0;
    const wide = modeRef.current === "optical" && optical(scene) ? opticalFrame(scene) : null, b = wide ?? scene.bbox;
    map.fitBounds([[b[0], b[1]], [b[2], b[3]]], { padding: { top: 72, bottom: reserve + 16, left: 32, right: 32 }, duration, maxZoom: 10 });
  }
  /**
   * Entrada do modo óptico: primeiro só nuvem, com a moldura da cena vazia; depois o radar entra varrendo, da direita
   * para a esquerda, e fica inteiro, como uma janela na nuvem.
   */
  function playReveal() {
    stopSwipe();
    if (reduceMotion()) { setSplit(0); return; }
    const HOLD = OPTICAL_FLY + 500, SWEEP = 1800, start = performance.now();
    setSplit(1);
    const tick = (now: number) => {
      const e = now - start;
      setSplit(e < HOLD ? 1 : 1 - easeInOut(clamp01((e - HOLD) / SWEEP)));
      if (e < HOLD + SWEEP) swipeRaf.current = requestAnimationFrame(tick);
      else swipeRaf.current = 0;
    };
    swipeRaf.current = requestAnimationFrame(tick);
  }
  function chooseMode(next: Mode) {
    const before = modeRef.current, scene = live.current.scenes.find((s) => s.id === nearIdRef.current);
    stopSwipe();
    modeRef.current = next;
    setMode(next);
    syncOptical();
    // entrar no modo óptico afasta o mapa até a nuvem ter textura; sair dele volta para perto da cena
    if (scene && optical(scene) && before !== next && (before === "optical" || next === "optical")) {
      frameScene(scene, OPTICAL_FLY);
      if (next === "optical") playReveal(); else setSplit(0.5);
    }
    repaintAll();
    live.current.onViewChange?.(next);
  }
  function choosePol(next: Polarization) {
    stopSwipe();
    polRef.current = next;
    setPol(next);
    repaintAll();
    report(nearScene);
  }
  /** Troca o par da cena. `quiet`: durante a animação, sem avisar o endereço. */
  function setSteps(scene: Scene, next: Steps, quiet = false) {
    stepsOf.current.set(scene.id, next);
    setStepsVersion((v) => v + 1);
    paintScene(scene);
    if (!quiet) report(scene);
  }
  function chooseTick(scene: Scene, k: number) {
    stopSwipe();
    setSteps(scene, pickStep(stepsFor(scene), k, scene.acquisitions.length));
  }
  function chooseSensitivity(value: number) {
    ratioRef.current = ratioFor(value);
    setSensitivity(value);
    repaintAll();
  }
  /** Área que mudou na cena em foco entre as duas passagens do par, medida na imagem com a sensibilidade atual. */
  const measured = (() => {
    if (!nearScene || mode !== "change" || isInterferogram(nearScene)) return null;
    void imageVersion;
    const change = changeFor(nearScene, polarizationFor(nearScene, pol), stepsFor(nearScene));
    if (!change) return null;
    const parts = changedParts(change, ratioFor(sensitivity)), area = bboxAreaKm2(nearScene.bbox), fraction = parts.down + parts.up;
    return { fraction, km2: fraction * area, fellKm2: parts.down * area, roseKm2: parts.up * area };
  })();
  // a comparação de escala vale para o lado que a cena descreve (água nova escurece; gelo ou solo molhado clareia)
  const measuredScale = measured && nearScene ? compareArea(nearScene.change === "darker" ? measured.fellKm2 : measured.roseKm2) : null;
  const dbText = (r: Reading) => (r.kind === "value" ? t.map.probeDb(f.num(r.db, 1)) : r.kind === "top" ? t.map.probeTop(f.num(r.db)) : t.map.probeFloor(f.num(r.db)));
  /** Área com dois ou três algarismos: a medida não sustenta mais que isso. */
  const km = (v: number) => f.num(v < 10 ? Number(v.toPrecision(2)) : Number(v.toPrecision(3)), v < 10 && v > 0 ? 1 : 0);
  function stopSwipe() {
    cancelAnimationFrame(swipeRaf.current);
    swipeRaf.current = 0;
    // interrompida no meio, a animação devolve o par que estava escolhido
    const w = walkRange.current;
    walkRange.current = null;
    const scene = w && live.current.scenes.find((s) => s.id === w.id);
    if (w && scene) setSteps(scene, w.steps, true);
  }
  /**
   * Toca a série: cada passagem entra por cima da anterior, varrida pelo divisor, da primeira à última do par.
   * No fim, volta ao par escolhido com o divisor no meio.
   */
  function playSwipe() {
    stopSwipe();
    const scene = live.current.scenes.find((s) => s.id === nearIdRef.current);
    if (!scene || reduceMotion()) return;
    const range = stepsFor(scene), legs = walk(range);
    const HOLD = 500, LEG = legs.length > 2 ? 1000 : 1500, SETTLE = 800, total = HOLD + legs.length * LEG + SETTLE;
    walkRange.current = { id: scene.id, steps: range };
    const start = performance.now();
    const tick = (now: number) => {
      const e = now - start;
      if (e < HOLD) { setSteps(scene, legs[0], true); setSplit(1); }
      else if (e < HOLD + legs.length * LEG) {
        const i = Math.floor((e - HOLD) / LEG), p = ((e - HOLD) % LEG) / LEG;
        setSteps(scene, legs[i], true);
        setSplit(1 - easeInOut(clamp01(p / 0.75)));
      } else {
        setSteps(scene, range, true);
        setSplit(0.5 * easeInOut(clamp01((e - HOLD - legs.length * LEG) / SETTLE)));
      }
      if (e < total) swipeRaf.current = requestAnimationFrame(tick);
      else { swipeRaf.current = 0; walkRange.current = null; }
    };
    swipeRaf.current = requestAnimationFrame(tick);
  }
  useEffect(() => {
    // a cena que saiu de foco perde o divisor e a nuvem; a que entrou toca a série
    syncOptical();
    repaintAll();
    report(nearScene);
    if (nearId && modeRef.current === "swipe") playSwipe();
    // chegou por link já no modo óptico: afasta o mapa e mostra a nuvem antes do radar
    if (nearScene && modeRef.current === "optical" && optical(nearScene)) { frameScene(nearScene, OPTICAL_FLY); playReveal(); }
    return stopSwipe;
  }, [nearId]);

  // ---------- movimentos ----------
  function reset() {
    const map = mapRef.current, box = boxRef.current;
    if (!map || !box) return;
    spinning.current = false;
    live.current.onHome?.();
    map.flyTo({ center: HOME, zoom: homeZoom(box.clientWidth - (box.clientWidth > 900 ? sideWidth() : 0), box.clientHeight - 220), duration: 2000 });
  }
  useImperativeHandle(ref, () => ({
    flyToScene(scene) { whenReady(() => {
      if (!mapRef.current) return;
      spinning.current = false;
      frameScene(scene, 2800);
    }); },
    flyToPlace(place) { whenReady(() => {
      const map = mapRef.current;
      if (!map) return;
      spinning.current = false;
      // países e estados: ampliação que faz o lugar ocupar boa parte da tela
      const zoom = place.spanDeg ? Math.max(1.8, Math.min(8, Math.log2(360 / place.spanDeg) + 0.4)) : 6.2;
      map.flyTo({ center: [place.lon, place.lat], zoom, duration: 2400 });
    }); },
    setView(view) { chooseMode(view); },
    play() { if (modeRef.current !== "swipe") chooseMode("swipe"); playSwipe(); },
    setPol(next) { choosePol(next); },
    setSensitivity(value) { chooseSensitivity(value); },
    showPass(scene, date) { whenReady(() => {
      const k = scene.acquisitions.findIndex((a) => a.date === date);
      if (k < 0 || isInterferogram(scene)) return;
      stopSwipe();
      if (modeRef.current !== "swipe") chooseMode("swipe");
      // a passagem pedida fica como a de depois, contra a anterior, com o divisor todo aberto nela; a primeira da série fica como a de antes
      setSteps(scene, k > 0 ? [k - 1, k] : [0, 1]);
      setSplit(k > 0 ? 0 : 1);
      if (nearScene?.id !== scene.id) { spinning.current = false; frameScene(scene, 1600); }
    }); },
    reset,
  }));

  // conta para a folha as medidas do par em tela: área de cada lado, histograma em dB e a tabela de limiares
  useEffect(() => {
    if (!ready) return;
    const scene = nearScene;
    const p = scene && polarizationFor(scene, pol);
    const change = scene && p && !isInterferogram(scene) ? changeFor(scene, p, stepsFor(scene)) : null;
    if (!scene || !p || !change) { live.current.onAnalysis?.(null); return; }
    const [from, to] = stepsFor(scene), area = bboxAreaKm2(scene.bbox), ratio = ratioFor(sensitivity), parts = changedParts(change, ratio);
    live.current.onAnalysis?.({
      sceneId: scene.id, pol: p, from: scene.acquisitions[from].date, to: scene.acquisitions[to].date, ratio,
      fellKm2: parts.down * area, roseKm2: parts.up * area, histogram: changeHistogram(change), table: thresholdTable(change, area),
      calibrated: scene.imagery === "gcov" && imageryFor(scene, p).outlines === null, example: !scene.acquisitions[to].images[p],
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nearScene, pol, sensitivity, imageVersion, stepsVersion, ready]);

  // painel do laboratório aberto ou fechado: o mapa desliza para manter a cena à vista na parte que sobra
  const labOpen = props.labOpen ?? false;
  const padded = useRef(false);
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready || window.matchMedia("(max-width: 900px)").matches) return;
    // ao abrir a página a margem já foi posta na criação do mapa: animar aqui cortaria o voo até a cena do link
    if (!padded.current) { padded.current = true; return; }
    const box = boxRef.current, right = sideWidth();
    // na visão do mundo o globo também muda de tamanho, para caber na parte livre; se o usuário já mexeu no zoom, ele fica como está
    const was = labOpen ? SHEET : labPanelWidth(window.innerWidth) + 32;
    const atHome = box !== null && Math.abs(map.getZoom() - homeZoom(box.clientWidth - was, box.clientHeight - 220)) < 0.05;
    const zoom = atHome && box ? homeZoom(box.clientWidth - right, box.clientHeight - 220) : map.getZoom();
    if (spinning.current) spinTarget.current = { right, zoom };
    else map.easeTo({ padding: { top: 64, right, bottom: 0, left: 0 }, zoom, duration: reduceMotion() ? 0 : 500 });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [labOpen, ready]);

  const audience = props.audience;
  return (
    <div className={near ? "map map--near" : "map"}>
      <div ref={boxRef} className="map__gl" role="application" aria-label={t.map.aria} />
      {!ready && !failed && <p className="map__status">{t.map.loading}</p>}
      {failed && <p className="map__status">{t.map.failed}</p>}
      {ripple && <span key={ripple.id} className="ping" style={{ transform: `translate(${ripple.x}px, ${ripple.y}px)` }} aria-hidden="true"><i /></span>}

      <div className="map__tools glass">
        <button type="button" className="map__word" onClick={reset}>{t.map.world}</button>
        <button type="button" className="map__word map__live" aria-pressed={clouds} aria-label={t.map.liveAria}
          onClick={() => { setLiveFailed(false); setClouds((on) => !on); }}><i aria-hidden="true" />{t.map.live}</button>
      </div>
      {(clouds || liveFailed) && (
        <p className="map__caption glass" role="status">
          {liveFailed ? t.map.liveFailed : !liveTime ? t.map.liveLoading : (
            <>
              <b>{nearScene ? t.map.liveLeadNear : t.map.liveLead}</b>
              {nearScene ? t.map.liveCaptionNear(f.shortDate(liveTime)) : t.map.liveCaption(f.shortDate(liveTime))}
            </>
          )}
        </p>
      )}

      {/* player: o par de passagens da cena aberta, como um controle de vídeo */}
      {nearScene ? (() => {
        const n = nearScene.acquisitions.length, [from, to] = stepsFor(nearScene);
        const p = polarizationFor(nearScene, pol), dateOf = (k: number) => nearScene.acquisitions[k].date;
        const total = Math.max(1, daysBetween(dateOf(0), dateOf(n - 1)));
        const at = (k: number) => daysBetween(dateOf(0), dateOf(k)) / total;
        const synthetic = !nearScene.acquisitions[to].images[p];
        const apart = daysBetween(dateOf(from), dateOf(to));
        // interferograma: cada passo é um par de passagens, só há antes/depois, e a legenda é a da fase
        // cena sem imagem óptica não tem modo óptico: fica no antes e depois
        const day = optical(nearScene) ? nearScene.opticalDay ?? null : null;
        const phase = isInterferogram(nearScene), shown: Mode = phase || (mode === "optical" && !day) ? "swipe" : mode, pairList = pairs(nearScene);
        const pairText = (k: number) => (pairList[k] ? t.map.pair(f.shortDate(pairList[k].from), f.shortDate(pairList[k].to)) : f.shortDate(dateOf(k)));
        void imageVersion;
        return (
          <section className="player glass" key={nearScene.id} aria-label={t.console.aria}>
            <header className="player__head">
              <p className="player__name">{nearScene.id !== props.selectedId && <b>{nearScene.name}</b>}<span>{phase ? t.console.spanPairs(pairList.length, pairList[0] ? daysBetween(pairList[0].from, pairList[0].to) : apart) : audience === "explore" ? t.console.spanPlain(apart) : t.console.span(apart)}</span></p>
              {audience !== "explore" && !phase && (
                <div className="pills pills--mono" role="group" aria-label={t.map.polAria}>
                  {(["HH", "HV"] as const).map((option) => {
                    const has = nearScene.polarizations.includes(option);
                    return (
                      <button key={option} type="button" aria-pressed={p === option} disabled={!has}
                        title={has ? `${option}: ${t.map.polHint[option]}` : t.map.polMissing(option)} onClick={() => choosePol(option)}>{option}</button>
                    );
                  })}
                </div>
              )}
              {!phase && (
                <div className="pills" role="group" aria-label={t.map.modeAria}>
                  <button type="button" aria-pressed={shown === "swipe"} onClick={() => chooseMode("swipe")}>{t.map.modeSwipe}</button>
                  <button type="button" aria-pressed={shown === "change"} onClick={() => chooseMode("change")}>{t.map.modeChange}</button>
                  {day && <button type="button" aria-pressed={shown === "optical"} title={day.caption} onClick={() => chooseMode("optical")}>{t.map.modeOptical}</button>}
                </div>
              )}
            </header>

            {/* com mais de duas passagens, uma linha de pontos escolhe o par; com duas, as datas ficam nas pontas do divisor */}
            {n > 2 && shown !== "optical" && (
              <div className="dots" role="group" aria-label={t.map.seriesAria(n)} style={{ "--from": at(from), "--to": at(to) } as CSSProperties}>
                <i aria-hidden="true" />
                {nearScene.acquisitions.map((a, k) => (
                  <button key={a.date} type="button" style={{ left: `${at(k) * 100}%` }} aria-pressed={k === from || k === to}
                    aria-label={t.console.pass(f.date(a.date))} title={f.date(a.date)} onClick={() => chooseTick(nearScene, k)} />
                ))}
              </div>
            )}

            {shown === "optical" && day ? (
              <>
                <div className="scrub">
                  {!reduceMotion() && <button type="button" className="scrub__play" onClick={playReveal} aria-label={t.map.opticalReplay} title={t.map.opticalReplay}>▶</button>}
                  <span className="scrub__date"><small>{t.map.opticalCamera(day.sensor)}</small>{f.shortDate(day.date)}</span>
                  <input id="swipe" type="range" min={0} max={1} step={0.01} value={divider} aria-label={t.map.opticalAria}
                    onPointerDown={stopSwipe} onChange={(e) => { stopSwipe(); setSplit(Number(e.target.value)); }} />
                  <span className="scrub__date scrub__date--end"><small>{t.map.radar}</small>{f.shortDate(dateOf(to))}</span>
                </div>
                <p className="player__legend">{day.caption}</p>
                <p className="player__note">{day.credit}</p>
              </>
            ) : shown === "swipe" ? (
              <div className={phase ? "scrub scrub--pairs" : "scrub"}>
                {!reduceMotion() && <button type="button" className="scrub__play" onClick={playSwipe} aria-label={t.map.replay(to - from)} title={t.map.replay(to - from)}>▶</button>}
                <span className="scrub__date"><small>{phase ? t.map.pairLabel(from + 1) : t.map.before}</small>{phase ? pairText(from) : f.shortDate(dateOf(from))}</span>
                <input id="swipe" type="range" min={0} max={1} step={0.01} value={divider} aria-label={t.map.swipeAria}
                  onPointerDown={stopSwipe} onChange={(e) => { stopSwipe(); setSplit(Number(e.target.value)); }} />
                <span className="scrub__date scrub__date--end"><small>{phase ? t.map.pairLabel(to + 1) : t.map.after}</small>{phase ? pairText(to) : f.shortDate(dateOf(to))}</span>
              </div>
            ) : measured ? (
              <div className="scrub scrub--change">
                {/* área perto de zero vira frase: "0 km²" parece defeito, e o dado real às vezes quase não muda */}
                {measured.fraction < ALMOST_NOTHING ? (
                  <p className="figure figure--none" aria-live="polite">
                    <b>{t.map.almostNothing}</b>
                    <span>{audience === "explore" ? "" : t.map.almostNothingHint}</span>
                  </p>
                ) : (
                  // queda e subida do sinal lado a lado, sem somar: são coisas diferentes no chão, e as cores do mapa são estas
                  <p className="figure figure--parts" aria-live="polite" title={t.map.changedShare(f.num(measured.fraction * 100, 1))}>
                    <b className="figure__fell">{negligibleArea(measured.fellKm2) ? t.map.fellNone : t.map.fell(km(measured.fellKm2))}</b>
                    <b className="figure__rose">{negligibleArea(measured.roseKm2) ? t.map.roseNone : t.map.rose(km(measured.roseKm2))}</b>
                    {audience === "explore" && measuredScale && (
                      <span>{t.map.scaleOf[nearScene.change]} {measuredScale.kind === "same" ? t.scenes.scaleSame(measuredScale.ref) : t.scenes.scaleTimes(f.num(measuredScale.times, measuredScale.times < 3 ? 1 : 0), measuredScale.ref)}</span>
                    )}
                  </p>
                )}
                {audience !== "explore" && (
                  <label className="sense" htmlFor="sensitivity" title={nearScene.imagery === "gcov" && !synthetic ? t.map.changeHowCalibrated : t.map.changeHow}>
                    <span>{t.map.sensitivity} <b>{f.num(ratioFor(sensitivity), 2)}×</b></span>
                    <input id="sensitivity" type="range" min={0} max={1} step={0.02} value={sensitivity}
                      aria-label={t.map.sensitivityAria} onChange={(e) => chooseSensitivity(Number(e.target.value))} />
                  </label>
                )}
              </div>
            ) : (
              <p className="player__note">{t.map.changeUnavailable}</p>
            )}
            {/* leitura em dB: só existe no dado calibrado, onde o cinza é uma medida */}
            {audience !== "explore" && shown !== "optical" && topDbFor(nearScene, p) !== null && (
              <p className="player__probe" aria-live="off">
                {probe ? (
                  <>
                    <span>{t.map.probeLead(p)}</span>
                    <b>{dbText(probe.before)}</b><small>{f.shortDate(dateOf(from))}</small>
                    <i aria-hidden="true">→</i>
                    <b>{dbText(probe.after)}</b><small>{f.shortDate(dateOf(to))}</small>
                  </>
                ) : <span>{t.map.probeHint}</span>}
              </p>
            )}
            {/* interferograma: a legenda da fase vale para todos os níveis, porque sem ela a imagem não se lê */}
            {phase && (phaseFailed.current.has(nearScene.id) ? (
              <p className="player__note player__note--warn" role="status">{t.map.phaseFailed}</p>
            ) : (
              <>
                <p className="player__legend"><i className="wheel-bw" aria-hidden="true" />{typeof nearScene.cycleCm === "number" ? t.map.phaseLegend(f.num(nearScene.cycleCm, 1)) : t.map.phaseLegendNoCm}</p>
                {audience !== "explore" && <p className="player__note">{t.map.phaseNote}{releases(nearScene).length > 0 && ` ${t.map.releaseNote(releases(nearScene).map((r) => t.map.release[r]).join(" + "))}`}</p>}
              </>
            ))}
            {audience !== "explore" && !phase && shown !== "optical" && <p className="player__note">{synthetic ? t.map.exampleImage : nearScene.imagery === "gcov" ? t.map.calibratedImage : t.map.realImage}{!synthetic && releases(nearScene).length > 0 && ` ${t.map.releaseNote(releases(nearScene).map((r) => t.map.release[r]).join(" + "))}`}</p>}
          </section>
        );
      })() : (
        <>
          {dragHint && <p className="map__hint"><span><i aria-hidden="true">↔</i>{t.map.hintDrag}<b>{t.map.hintTouch}</b></span></p>}
          {clickHint && props.hoverId === null && <span className="map__tip" ref={tipRef} aria-hidden="true">{t.map.hintClick}</span>}
        </>
      )}
    </div>
  );
});
