import { useEffect, useMemo, useRef, useState } from "react";
import { useI18n } from "../i18n";
import { timed } from "../lib/perf";
import { measuredOutputSnrDb, pulseFigures, simulatePulse } from "../lib/pulse";

/** Bandas e durações de pulso usadas no radar de banda L do NISAR. */
const BANDS = [5, 20, 40, 77], DURATIONS = [5, 20, 25, 40, 45];

interface TraceProps {
  data: Float64Array;
  /** Outra curva por cima, na cor de destaque (o eco escondido no ruído, por exemplo). */
  over?: Float64Array;
  /** A curva de cima usa a própria escala (o maior valor dela ocupa a altura toda). */
  overOwnScale?: boolean;
  from?: number;
  to?: number;
  /** "wave": oscila em volta do zero. "power": só para cima, a partir da base. */
  kind: "wave" | "power";
  tone?: "ink" | "ice" | "mute";
  /** Valor que ocupa a altura toda. Sem ele, o maior valor do trecho. */
  full?: number;
  /** Linhas verticais (posição em amostras), para marcar onde estão os alvos. */
  marks?: number[];
  height?: number;
  label: string;
}

/** Uma curva desenhada em canvas: para cada coluna de pixels, o mínimo e o máximo das amostras que caem nela. */
function Trace({ data, over, overOwnScale, from = 0, to = data.length, kind, tone = "ink", full, marks, height = 84, label }: TraceProps) {
  const ref = useRef<HTMLCanvasElement>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const watch = new ResizeObserver(() => setWidth(el.clientWidth));
    watch.observe(el);
    return () => watch.disconnect();
  }, []);
  useEffect(() => {
    const el = ref.current;
    if (!el || !width) return;
    const ratio = Math.min(2, window.devicePixelRatio || 1), w = Math.round(width * ratio), h = Math.round(height * ratio);
    el.width = w; el.height = h;
    const g = el.getContext("2d");
    if (!g) return;
    const css = getComputedStyle(el), color = (name: string) => css.getPropertyValue(name).trim();
    let top = full ?? 0;
    if (!full) for (let k = from; k < to; k++) top = Math.max(top, Math.abs(data[k]));
    top = top || 1;
    const span = to - from, zero = kind === "wave" ? h / 2 : h - 2 * ratio, reach = kind === "wave" ? h / 2 - 2 * ratio : h - 6 * ratio;
    const draw = (values: Float64Array, stroke: string, alpha: number) => {
      g.globalAlpha = alpha; g.strokeStyle = stroke; g.fillStyle = stroke; g.lineWidth = ratio;
      g.beginPath();
      if (span <= 3 * w) { // poucas amostras por pixel: liga os pontos
        for (let k = from; k < to; k++) {
          const px = ((k - from) / Math.max(1, span - 1)) * w, py = zero - Math.max(-1, Math.min(1, values[k] / top)) * reach;
          if (k === from) g.moveTo(px, py); else g.lineTo(px, py);
        }
        g.lineWidth = 1.6 * ratio; g.stroke();
        return;
      }
      for (let px = 0; px < w; px++) {
        const a = from + Math.floor((px / w) * span), b = Math.max(a + 1, from + Math.floor(((px + 1) / w) * span));
        let lo = Infinity, hi = -Infinity;
        for (let k = a; k < b && k < to; k++) { if (values[k] < lo) lo = values[k]; if (values[k] > hi) hi = values[k]; }
        if (kind === "power") lo = 0;
        const y1 = zero - Math.max(-1, Math.min(1, hi / top)) * reach, y2 = zero - Math.max(-1, Math.min(1, lo / top)) * reach;
        g.rect(px, y1, 1, Math.max(ratio, y2 - y1));
      }
      g.fill();
    };
    g.clearRect(0, 0, w, h);
    g.globalAlpha = 1; g.fillStyle = color("--line"); g.fillRect(0, Math.round(zero), w, ratio);
    if (marks) { g.fillStyle = color("--amber"); g.globalAlpha = 0.7; for (const m of marks) g.fillRect(Math.round(((m - from) / span) * w), 0, ratio, h); }
    draw(data, color(tone === "ice" ? "--ice" : tone === "mute" ? "--dim" : "--soft"), tone === "mute" ? 0.9 : 1);
    if (over) {
      if (overOwnScale) { top = 0; for (let k = from; k < to; k++) top = Math.max(top, Math.abs(over[k])); top = top || 1; }
      draw(over, color("--ice"), overOwnScale ? 0.55 : 0.95);
    }
    g.globalAlpha = 1;
  }, [data, over, overOwnScale, from, to, kind, tone, full, marks, width, height]);
  return <canvas ref={ref} className="trace" style={{ height }} role="img" aria-label={label} />;
}

/** Compressão de pulso, com os controles na mão: por que um eco fraco e espalhado vira um pico estreito. */
export function PulseLab() {
  const { t, f } = useI18n();
  const [band, setBand] = useState(20);
  const [duration, setDuration] = useState(25);
  const [snr, setSnr] = useState(-15);
  const [separation, setSeparation] = useState(30);
  const [seed, setSeed] = useState(4);
  /** Uma parte por vez: a simulação, ou a conta por dentro (os números e o passo pela frequência). */
  const [part, setPart] = useState<"sim" | "inside">("sim");
  const params = { bandwidthMHz: band, durationUs: duration, snrDb: snr, separationM: separation, seed };
  const sim = useMemo(() => timed("pulse", () => simulatePulse(params)), [band, duration, snr, separation, seed]); // eslint-disable-line react-hooks/exhaustive-deps
  const fig = pulseFigures(params);
  const out = useMemo(() => measuredOutputSnrDb(sim), [sim]);
  // zoom: uns 12 pixels de resolução para cada lado dos alvos
  const last = sim.targets[sim.targets.length - 1], pad = Math.max(24, Math.round((6 * fig.resolutionM) / sim.metersPerSample));
  const zoomFrom = Math.max(0, sim.targets[0] - pad), zoomTo = Math.min(sim.n, last + pad);
  const zoomMeters = (zoomTo - zoomFrom) * sim.metersPerSample;
  const meters = (m: number) => (m >= 1000 ? `${f.num(m / 1000, 1)} km` : `${f.num(m, m < 10 ? 1 : 0)} m`);
  const signed = (n: number) => (n < 0 ? `−${f.num(-n)}` : f.num(n));
  const millions = (n: number) => (n >= 1e6 ? `${f.num(n / 1e6, 1)} M` : `${f.num(Math.round(n / 1e3))} k`);

  return (
    <div className="pulse-lab">
      <header className="lab__intro">
        <div><p className="lab__kicker">{t.lab.pulse.kicker}</p><h2 className="lab__title">{t.lab.pulse.title}</h2></div>
        <p className="lab__lead">{t.lab.brief.pulse}</p>
      </header>

      <nav className="sections sections--lab" aria-label={t.lab.sectionsAria}>
        {(["sim", "inside"] as const).map((id) => <button key={id} type="button" aria-pressed={part === id} onClick={() => setPart(id)}>{t.lab.sections[id]}</button>)}
      </nav>

      <div className="pulse-lab__main">
        <div className="knobs">
          <div className="knob">
            <span id="knob-band">{t.lab.pulse.bandwidth}</span>
            <div className="pills pills--mono" role="group" aria-labelledby="knob-band">
              {BANDS.map((b) => <button key={b} type="button" aria-pressed={band === b} onClick={() => setBand(b)}>{b} MHz</button>)}
            </div>
          </div>
          <div className="knob">
            <span id="knob-duration">{t.lab.pulse.duration}</span>
            <div className="pills pills--mono" role="group" aria-labelledby="knob-duration">
              {DURATIONS.map((d) => <button key={d} type="button" aria-pressed={duration === d} onClick={() => setDuration(d)}>{d} µs</button>)}
            </div>
          </div>
          <div className="knob">
            <label htmlFor="knob-snr">{t.lab.pulse.snr}<output>{t.lab.pulse.snrValue(snr)}</output></label>
            <input id="knob-snr" type="range" min={-30} max={10} step={1} value={snr} onChange={(e) => setSnr(Number(e.target.value))} />
          </div>
          <div className="knob">
            <label htmlFor="knob-sep">{t.lab.pulse.separation}<output>{separation ? t.lab.pulse.sepValue(separation) : t.lab.pulse.sepOne}</output></label>
            <input id="knob-sep" type="range" min={0} max={80} step={1} value={separation} onChange={(e) => setSeparation(Number(e.target.value))} />
          </div>
          <button type="button" className="ghost" onClick={() => setSeed((s) => s + 1)}>{t.lab.pulse.noise}</button>
          {part === "inside" && <p className="meta">{t.lab.pulse.modes}</p>}

          <dl className={part === "inside" ? "figures" : "figures figures--brief"}>
            <div><dt>{t.lab.pulse.figures.gain}</dt><dd><b>{f.num(Math.round(fig.gain))}×</b> {t.lab.pulse.figures.gainDb(f.num(fig.gainDb, 1))}</dd></div>
            <div><dt>{t.lab.pulse.figures.sharp}</dt><dd><b>{meters(fig.pulseLengthM)} → {meters(fig.resolutionM)}</b></dd></div>
            <div><dt>{t.lab.pulse.figures.snr}</dt><dd><b>{signed(snr)} dB → {signed(Math.round(out))} dB</b> {t.lab.pulse.figures.snrTheory(signed(Math.round(snr + fig.gainDb)))}</dd></div>
            <div><dt>{t.lab.pulse.figures.cost}</dt><dd><b>{millions(sim.costFft)}</b> {t.lab.pulse.figures.costDirect(millions(sim.costDirect))}</dd></div>
          </dl>
        </div>

        <ol className="stages">
          <li>
            <h3>{t.lab.pulse.steps.sent}<small>{t.lab.pulse.steps.sentNote(duration, meters(fig.pulseLengthM))}</small></h3>
            <Trace data={sim.chirp} kind="wave" tone="ice" full={1} label={t.lab.pulse.steps.sent} height={64} />
          </li>
          <li>
            <h3>{t.lab.pulse.steps.echo}<small>{t.lab.pulse.steps.echoNote}</small></h3>
            <Trace data={sim.echo} over={sim.clean} kind="wave" tone="mute" label={t.lab.pulse.steps.echo} />
          </li>
          {part === "inside" && <li>
            <h3>{t.lab.pulse.steps.freq}<small>{t.lab.pulse.steps.freqNote}</small></h3>
            <Trace data={sim.spectrumEcho} over={sim.spectrumPulse} overOwnScale kind="power" tone="mute" label={t.lab.pulse.steps.freq} height={64} />
          </li>}
          <li className="stages__out">
            <div>
              <h3>{t.lab.pulse.steps.out}<small>{t.lab.pulse.steps.outNote}</small></h3>
              <Trace data={sim.compressed} kind="power" tone="ink" label={t.lab.pulse.steps.out} height={104} />
            </div>
            <div>
              <h3>{t.lab.pulse.steps.zoom}<small>{t.lab.pulse.steps.zoomNote(meters(zoomMeters))}</small></h3>
              <Trace data={sim.compressed} from={zoomFrom} to={zoomTo} kind="power" tone="ink" marks={sim.targets} label={t.lab.pulse.steps.zoom} height={104} />
            </div>
          </li>
        </ol>
      </div>
      <p className="lab__verdict">{separation === 0 ? t.lab.pulse.verdictOne : separation > fig.resolutionM * 1.3 ? t.lab.pulse.verdictSplit(meters(separation), meters(fig.resolutionM)) : t.lab.pulse.verdictMerged(meters(separation), meters(fig.resolutionM))}</p>
      {part === "inside" && <><p className="lab__lead">{t.lab.pulse.lead}</p><p className="meta">{t.lab.pulse.why}</p></>}
    </div>
  );
}
