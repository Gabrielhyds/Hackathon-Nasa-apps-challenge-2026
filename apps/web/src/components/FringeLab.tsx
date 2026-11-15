import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import meta from "../assets/insar/insar.json";
import beforeUrl from "../assets/insar/before.png";
import quakeUrl from "../assets/insar/quake.png";
import { useI18n } from "../i18n";
import { MIN_COHERENCE, fringeReading, paintPhase, parseLut, readTransect, type Point } from "../lib/fringes";

type PairId = "before" | "quake";
const URLS: Record<PairId, string> = { before: beforeUrl, quake: quakeUrl };
const PAIRS = meta.pairs as Record<PairId, { first: string; second: string; width: number; height: number; bbox: number[]; kmPerPixel: number }>;
const LUT = parseLut(meta.lut);
/** Quanto vale uma franja, em centímetros de mudança na distância até o satélite. A tela diz isso e não multiplica. */
const CYCLE_CM = meta.cycleCm;
const { width: W, height: H, bbox: BBOX, kmPerPixel: KM } = PAIRS.quake;
const toPixel = (lon: number, lat: number): Point => ({ x: ((lon - BBOX[0]) / (BBOX[2] - BBOX[0])) * W, y: ((BBOX[3] - lat) / (BBOX[3] - BBOX[1])) * H });
const EVENTS = meta.events.map((e) => ({ ...e, ...toPixel(e.lon, e.lat) }));
/** Linhas prontas, em pixels da imagem: do interior estável até perto de cada epicentro, e uma longe dos dois. */
const PRESETS: Record<"main" | "west" | "far", [Point, Point]> = {
  main: [{ x: 500, y: 430 }, { x: 552, y: 286 }],
  west: [{ x: 275, y: 462 }, { x: 300, y: 333 }],
  far: [{ x: 70, y: 150 }, { x: 150, y: 330 }],
};
const SCALE_KM = 50;

/** Lê a fase (um byte por pixel) de um PNG em tons de cinza. */
function usePhase(url: string): Uint8Array | null {
  const [phase, setPhase] = useState<Uint8Array | null>(null);
  useEffect(() => {
    let alive = true;
    const img = new Image();
    img.onload = () => {
      const c = document.createElement("canvas");
      c.width = img.naturalWidth; c.height = img.naturalHeight;
      const g = c.getContext("2d", { willReadFrequently: true });
      if (!g || !alive) return;
      g.drawImage(img, 0, 0);
      const rgba = g.getImageData(0, 0, c.width, c.height).data, out = new Uint8Array(c.width * c.height);
      for (let i = 0; i < out.length; i++) out[i] = rgba[i * 4];
      setPhase(out);
    };
    img.src = url;
    return () => { alive = false; };
  }, [url]);
  return phase;
}

/** A régua de franjas sobre o interferograma real do terremoto da Venezuela: arraste as pontas e conte as franjas. */
export function FringeLab() {
  const { t, f } = useI18n();
  const [pair, setPair] = useState<PairId>("quake");
  const [ends, setEnds] = useState<[Point, Point]>(PRESETS.main);
  /** Uma parte por vez: a régua sobre o interferograma, ou como ler o que ela conta. */
  const phases: Record<PairId, Uint8Array | null> = { before: usePhase(URLS.before), quake: usePhase(URLS.quake) };
  const canvas = useRef<HTMLCanvasElement>(null);
  const svg = useRef<SVGSVGElement>(null);
  const drag = useRef<number | null>(null);
  const phase = phases[pair];

  useEffect(() => {
    const g = canvas.current?.getContext("2d");
    if (!g || !phase) return;
    const image = g.createImageData(W, H);
    paintPhase(phase, LUT, image.data);
    g.putImageData(image, 0, 0);
  }, [phase]);

  const read = (data: Uint8Array | null) => (data ? readTransect(data, W, H, ends[0], ends[1]) : null);
  const transect = useMemo(() => read(phase), [phase, ends]); // eslint-disable-line react-hooks/exhaustive-deps
  const other: PairId = pair === "quake" ? "before" : "quake";
  const otherTransect = useMemo(() => read(phases[other]), [phases[other], ends]); // eslint-disable-line react-hooks/exhaustive-deps
  const reading = transect && fringeReading(transect);
  const otherReading = otherTransect && fringeReading(otherTransect);
  const lengthKm = Math.hypot(ends[1].x - ends[0].x, ends[1].y - ends[0].y) * KM;

  const clampPoint = (p: Point): Point => ({ x: Math.max(4, Math.min(W - 4, p.x)), y: Math.max(4, Math.min(H - 4, p.y)) });
  const moveEnd = (i: number, p: Point) => setEnds((old) => (i === 0 ? [clampPoint(p), old[1]] : [old[0], clampPoint(p)]));
  function pointer(e: PointerEvent<SVGElement>) {
    if (drag.current === null || !svg.current) return;
    const box = svg.current.getBoundingClientRect();
    moveEnd(drag.current, { x: ((e.clientX - box.left) / box.width) * W, y: ((e.clientY - box.top) / box.height) * H });
  }
  function keys(i: number, e: KeyboardEvent<SVGElement>) {
    const step = e.shiftKey ? 12 : 3, by: Record<string, [number, number]> = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
    const d = by[e.key];
    if (!d) return;
    e.preventDefault();
    moveEnd(i, { x: ends[i].x + d[0], y: ends[i].y + d[1] });
  }

  // perfil: franjas ao longo da régua
  const PW = 320, PH = 120;
  const profile = useMemo(() => {
    if (!transect) return null;
    const turns = Array.from(transect.cycles), lo = Math.min(0, ...turns), hi = Math.max(0, ...turns), span = Math.max(1, hi - lo);
    const px = (i: number) => (i / (turns.length - 1)) * PW, py = (v: number) => 8 + ((hi - v) / span) * (PH - 16);
    // um traço cheio por trecho confiável e, entre dois trechos, uma ligação tracejada por cima do ruído.
    // Ruído ou falta de dado nas pontas da régua fica em branco: ali não há o que ler
    const runs: [number, number][][] = [];
    let run: [number, number][] = [];
    turns.forEach((v, i) => {
      if (transect.coherence[i] >= MIN_COHERENCE) run.push([px(i), py(v)]);
      else if (run.length) { runs.push(run); run = []; }
    });
    if (run.length) runs.push(run);
    const text = (points: [number, number][]) => points.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
    const bridges = runs.slice(1).map((next, k) => text([runs[k][runs[k].length - 1], next[0]]));
    const lines: number[] = [];
    for (let v = Math.ceil(lo); v <= hi + 1e-6; v += 1) lines.push(py(v));
    return { runs: runs.map(text), bridges, lines };
  }, [transect]);

  return (
    <div className="fringe-lab">
      <header className="lab__intro">
        <div><p className="lab__kicker">{t.lab.fringes.kicker}</p><h2 className="lab__title">{t.lab.fringes.title}</h2></div>
        <p className="lab__lead">{t.lab.brief.fringes(f.num(CYCLE_CM, 0))}</p>
      </header>

      <div className="fringe-lab__main">
        <figure className="fringe-map">
          <div className="fringe-map__stage">
            <canvas ref={canvas} width={W} height={H} role="img" aria-label={t.lab.fringes.mapAria(f.date(PAIRS[pair].first), f.date(PAIRS[pair].second))} />
            {!phase && <p className="map__status">{t.lab.fringes.loading}</p>}
            <svg ref={svg} viewBox={`0 0 ${W} ${H}`} onPointerMove={pointer} onPointerUp={() => { drag.current = null; }} onPointerLeave={() => { drag.current = null; }}>
              {pair === "quake" && EVENTS.map((e) => (
                <g key={e.mag} className="fringe-map__event" transform={`translate(${e.x} ${e.y})`}>
                  <circle r="9" /><path d="M-13 0H-5M5 0H13M0-13V-5M0 5V13" />
                  <text x="14" y="-10">{t.lab.fringes.event(f.num(e.mag, 1))}</text>
                </g>
              ))}
              <line className="fringe-map__ruler-back" x1={ends[0].x} y1={ends[0].y} x2={ends[1].x} y2={ends[1].y} />
              <line className="fringe-map__ruler" x1={ends[0].x} y1={ends[0].y} x2={ends[1].x} y2={ends[1].y} />
              {ends.map((p, i) => (
                <circle key={i} className="fringe-map__end" cx={p.x} cy={p.y} r="11" tabIndex={0} role="slider" aria-label={i === 0 ? t.lab.fringes.endA : t.lab.fringes.endB}
                  aria-valuetext={`${Math.round(p.x)}, ${Math.round(p.y)}`}
                  onPointerDown={(e) => { drag.current = i; (e.target as SVGElement).setPointerCapture?.(e.pointerId); }} onKeyDown={(e) => keys(i, e)} />
              ))}
              <g className="fringe-map__scale" transform={`translate(${W - 24 - SCALE_KM / KM} ${H - 22})`}>
                <path d={`M0 -5V0H${SCALE_KM / KM}V-5`} /><text x={SCALE_KM / KM / 2} y="-8" textAnchor="middle">{SCALE_KM} km</text>
              </g>
            </svg>
          </div>
          <figcaption>
            <div className="wheel" aria-hidden="true"><i style={{ background: `linear-gradient(90deg, ${[0, 32, 64, 96, 128, 160, 192, 224, 255].map((k) => `#${meta.lut[k]}`).join(", ")})` }} /><span>{t.lab.fringes.wheel(f.num(CYCLE_CM, 1))}</span></div>
            <span className="meta">{t.lab.fringes.hint}</span>
          </figcaption>
        </figure>

        <div className="fringe-read">
          <div className="pills" role="group" aria-label={t.lab.fringes.pairAria}>
            {(["before", "quake"] as PairId[]).map((id) => <button key={id} type="button" aria-pressed={pair === id} onClick={() => setPair(id)}>{t.lab.fringes.pair[id]}</button>)}
          </div>
          <p className="meta">{t.lab.fringes.pairDates(f.date(PAIRS[pair].first), f.date(PAIRS[pair].second))}</p>

          <div className="fringe-read__big" aria-live="polite">
            {reading && (reading.reliable ? (
              <>
                <b>{f.num(reading.fringes, 1)}</b>
                <span>{t.lab.fringes.count(f.num(CYCLE_CM, 1))}</span>
                <small>{t.lab.fringes.readingLabel(f.num(lengthKm, 0))}</small>
              </>
            ) : <p className="fringe-read__warn">{t.lab.fringes.unreliable}</p>)}
          </div>

          {profile && (
            <svg className="fringe-profile" viewBox={`0 0 ${PW} ${PH}`} role="img" aria-label={t.lab.fringes.profileAria}>
              {profile.lines.map((yy, i) => <line key={i} x1="0" x2={PW} y1={yy} y2={yy} />)}
              {profile.bridges.map((points, i) => <polyline key={`b${i}`} className="fringe-profile__noise" points={points} />)}
              {profile.runs.map((points, i) => <polyline key={i} points={points} />)}
            </svg>
          )}
          <p className="meta">{t.lab.fringes.profileNote}</p>

          {reading?.reliable && otherReading?.reliable && (
            <p className="fringe-read__compare">{pair === "quake" ? t.lab.fringes.compareCalm(f.num(otherReading.fringes, 1)) : t.lab.fringes.compareQuake(f.num(otherReading.fringes, 1))}</p>
          )}

          <div className="chips" role="group" aria-label={t.lab.fringes.presetsAria}>
            {(Object.keys(PRESETS) as (keyof typeof PRESETS)[]).map((id) => <button key={id} type="button" onClick={() => setEnds(PRESETS[id])}>{t.lab.fringes.presets[id]}</button>)}
          </div>
        </div>
      </div>

      <details className="fold">
        <summary>{t.lab.sections.read}</summary>
          <p className="lab__lead">{t.lab.fringes.lead(f.num(CYCLE_CM, 0))}</p>
          <ul className="notes notes--grid">{t.lab.fringes.notes(f.num(CYCLE_CM * 2, 0), f.num(CYCLE_CM, 0)).map((line) => <li key={line}>{line}</li>)}</ul>
          <p className="meta">{t.lab.fringes.source}</p>
      </details>
    </div>
  );
}
