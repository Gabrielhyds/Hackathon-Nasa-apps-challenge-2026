import { useEffect, useRef, useState, type PointerEvent, type ReactNode } from "react";
import { hasOptical } from "../lib/optical";
import type { Polarization, Scene } from "@nexxus/contract";
import { useI18n } from "../i18n";
import { dbToRatio, negligibleArea, ratioToDb, type MapAnalysis } from "../lib/analysis";
import type { Audience } from "../lib/audience";
import { ratioFor, sensitivityFor } from "../lib/change";
import { NISAR, bboxAreaKm2 } from "../lib/geo";
import { peakSample } from "../lib/hydro";
import { hasOrigin, missingPct, passOrigins, whitePoints } from "../lib/provenance";
import type { RankedScene } from "../lib/ranking";
import { daysBetween, isInterferogram, pairs } from "../lib/series";
import type { Lab } from "../lib/urlState";
import { HydroSpark } from "./HydroSpark";
import { RadarDiagram } from "./RadarDiagram";

type View = "swipe" | "change" | "optical";

/**
 * As seções da folha em cada nível de detalhe. No Simples a folha é uma história curta, sem seções; um botão no fim
 * dela abre a atividade da turma, que volta para a história. Nos Dados, uma seção por vez: leitura, medida e origem.
 */
type Section = "story" | "activity" | "measure" | "origin";
const SECTIONS: Record<Audience, Section[]> = {
  explore: [],
  analyze: ["story", "measure", "origin"],
};

interface Props {
  audience: Audience;
  ranked: RankedScene[];
  selectedId: string | null;
  picked: string[];
  view: View;
  /** Medidas do par em tela, vindas do mapa. Só valem quando são da cena aberta. */
  analysis: MapAnalysis | null;
  onTogglePick(id: string): void;
  onView(view: View): void;
  /** Abre um painel do laboratório: o hidrograma da cena ou a física do radar. */
  onLab(panel: Lab): void;
  /** Comandos para o mapa: tocar o antes e depois, trocar a polarização e mudar o limiar do mapa de mudança. */
  onPlay(): void;
  onPol(pol: Polarization): void;
  onSensitivity(value: number): void;
}

/** A legenda da cena aberta, escrita para quem está lendo: curioso, quem ensina ou quem analisa. */
export function SceneSheet(props: Props) {
  const { audience, ranked, selectedId, picked, view, onTogglePick, onView, onLab } = props;
  const { t, f } = useI18n();
  const [copy, setCopy] = useState<"idle" | "done" | "failed">("idle");
  const sections = SECTIONS[audience];
  const [section, setSection] = useState<Section>("story");
  // trocou o nível de detalhe: a folha volta para a primeira seção dele
  useEffect(() => { setSection("story"); }, [audience]);
  const entry = ranked.find((r) => r.scene.id === selectedId);
  if (!entry) return <p className="muted">{t.sheet.none}</p>;
  const { scene } = entry;
  // a atividade não é uma seção do menu: abre pelo botão do Simples
  const shown: Section = sections.includes(section) || (audience === "explore" && section === "activity") ? section : "story";
  const first = scene.acquisitions[0].date, last = scene.acquisitions[scene.acquisitions.length - 1].date;
  const days = daysBetween(first, last), laps = Math.round(days / NISAR.repeatDays);
  const real = Boolean(scene.acquisitions[0].images[scene.polarizations[0] ?? "HH"]);
  // interferograma: a imagem é a fase de pares de passagens; a explicação de claro e escuro não vale para ela
  const phase = isInterferogram(scene), pairList = pairs(scene).map((p) => t.map.pair(f.date(p.from), f.date(p.to)));
  const compare = picked.map((id) => ranked.find((r) => r.scene.id === id)?.scene).filter((s): s is Scene => Boolean(s));
  const analysis = props.analysis?.sceneId === scene.id ? props.analysis : null;

  function copyLink() {
    navigator.clipboard.writeText(window.location.href).then(() => setCopy("done"), () => setCopy("failed"));
  }

  /** Em que a cena se apoia: base, ressalva e fontes. */
  const basis = (scene.basis || scene.caveat || scene.sources?.length) ? (
    <section className="basis">
      {scene.basis && <p className="basis__tag" title={t.sheet.basisHint[scene.basis]}><i className={`basis__dot basis__dot--${scene.basis}`} />{t.sheet.basis[scene.basis]}</p>}
      {scene.caveat && <p className="basis__caveat"><b>{t.sheet.caveatLead}.</b> {scene.caveat}</p>}
      {scene.sources && scene.sources.length > 0 && (
        <div className="basis__sources">
          <h3>{t.sheet.sourcesLead}</h3>
          <ul>{scene.sources.map((s) => <li key={s.url}><a href={s.url} target="_blank" rel="noreferrer">{s.title}</a></li>)}</ul>
        </div>
      )}
    </section>
  ) : null;

  // a régua de cheia é a história central da cena que a tem: vem logo abaixo do título, com o número do pico em destaque
  const peak = scene.waterSeries ? peakSample(scene.waterSeries.samples) : null;
  const hydro = scene.waterSeries && peak ? (
    <section className="block block--hydro">
      <h3 className="block__lead">{t.lab.teaser.lead}</h3>
      <p className="hydro__figure"><b>≈ {f.num(peak.newWaterKm2, 0)} km²</b><span>{t.lab.hydro.pass.water} · {f.date(peak.date)}</span></p>
      <HydroSpark samples={scene.waterSeries.samples} />
      <p>{t.lab.teaser.passes(scene.waterSeries.samples.length)}</p>
      <button type="button" className="action" onClick={() => onLab("hydro")}>{t.lab.teaser.open}</button>
    </section>
  ) : null;

  /** O que a imagem de fase mostra, no lugar do claro e escuro. */
  const phaseBlock = (
    <section className="block">
      <h3 className="block__lead">{t.sheet.phaseLead}</h3>
      <p>{t.sheet.phaseBody}</p>
      <ul className="keys">
        <li><i className="key key--bright" />{t.sheet.phaseKeys.white}</li>
        <li><i className="key key--phase" />{t.sheet.phaseKeys.dark}</li>
        <li><i className="key key--gap" />{t.sheet.phaseKeys.gap}</li>
      </ul>
      <p>{typeof scene.cycleCm === "number" ? t.sheet.phaseCycle(f.num(scene.cycleCm, 1)) : t.sheet.phaseCycleNoCm}</p>
      <p className="muted">{t.sheet.phasePairs(pairList.join("; "))}</p>
      <button type="button" className="action" onClick={() => onLab("fringes")}>{t.sheet.openFringes}</button>
    </section>
  );

  const whatBlock = (
    <section className="block">
      <h3 className="block__lead">{t.sheet.whatLead}</h3>
      <p>{t.sheet.notPhoto}</p>
      <ul className="keys">
        <li><i className="key key--dark" />{t.sheet.keys.dark}</li>
        <li><i className="key key--bright" />{t.sheet.keys.bright}</li>
        <li><i className="key key--changed" />{t.sheet.keys.changed}</li>
      </ul>
      <p className="muted">{scene.acquisitions.length > 2 ? t.sheet.visitsMany(scene.acquisitions.length, f.date(first), f.date(last), days) : t.sheet.visits(f.date(first), f.date(last), days, laps)}</p>
      <button type="button" className="action" onClick={() => onView(view === "change" ? "swipe" : "change")}>
        {view === "change" ? t.sheet.seeSwipe : t.sheet.seeChange}
      </button>
      {hasOptical(scene) && view !== "optical" && <button type="button" className="action action--quiet" onClick={() => onView("optical")}>{t.sheet.seeOptical}</button>}
    </section>
  );

  return (
    <article className="sheet-scene" key={scene.id}>
      <header className="place">
        <p className="place__where">{scene.region} · {f.coords(scene.lat, scene.lon)}</p>
        <h2 className="place__name">{scene.name}</h2>
        <p className="place__event">{scene.event}</p>
      </header>

      {sections.length > 0 && (
        <nav className="sections" aria-label={t.sheet.sectionsAria}>
          {sections.map((s) => <button key={s} type="button" aria-pressed={shown === s} onClick={() => setSection(s)}>{t.sheet.sections[s]}</button>)}
        </nav>
      )}

      {shown === "story" && (
        <>
          {hydro}
          <p className="reading">{scene.summary}</p>
          {basis}
          {audience === "explore" && (phase ? phaseBlock : whatBlock)}
          {audience === "explore" && !phase && (
            <button type="button" className="action action--quiet" onClick={() => setSection("activity")}>{t.sheet.next.activity}</button>
          )}
          {audience !== "explore" && sections[1] && (
            <button type="button" className="action action--next" onClick={() => setSection(sections[1])}>{phase ? t.sheet.nextPhase : t.sheet.next[sections[1]]}</button>
          )}
        </>
      )}

      {shown === "activity" && (phase ? phaseBlock : (
        <>
          <button type="button" className="link" onClick={() => setSection("story")}>{t.sheet.backToStory}</button>
          <Activity key={scene.id} scene={scene} analysis={analysis} view={view} onView={onView} onPlay={props.onPlay} onPol={props.onPol} />
          <p className="copy">
            <button type="button" className="action action--quiet" onClick={copyLink}>{t.sheet.copy}</button>
            <span role="status">{copy === "done" ? t.sheet.copied : copy === "failed" ? t.sheet.copyFailed : ""}</span>
          </p>
          {/* como o radar vê: recolhido no fim da atividade, para quem quiser a explicação */}
          <details className="fold">
            <summary>{t.sheet.howLead}</summary>
            <RadarDiagram />
            <button type="button" className="action action--quiet" onClick={() => onLab("pulse")}>{t.lab.teaser.physics}</button>
          </details>
        </>
      ))}

      {shown === "measure" && (phase ? phaseBlock : (
        <Measure scene={scene} analysis={analysis} view={view} onView={onView} onSensitivity={props.onSensitivity} />
      ))}

      {shown === "origin" && (
        <>
          <section className="block">
            <h3 className="block__lead">{t.sheet.recordLead}</h3>
            <dl className="record">
              <dt>{t.sheet.fields.center}</dt><dd>{f.num(scene.lat, 3)}, {f.num(scene.lon, 3)}</dd>
              <dt>{t.sheet.fields.crop}</dt><dd>{scene.bbox.map((v) => f.num(v, 2)).join(" · ")}</dd>
              <dt>{t.sheet.fields.cropArea}</dt><dd>{t.scenes.areaValue(f.num(Number(bboxAreaKm2(scene.bbox).toPrecision(3))))}</dd>
              {phase ? (
                <>
                  <dt>{t.sheet.fields.pairs}</dt><dd>{pairs(scene).map((p) => `${p.from} → ${p.to}`).join(" · ")}</dd>
                  {typeof scene.cycleCm === "number" && <><dt>{t.sheet.fields.cycle}</dt><dd>{t.sheet.cycleValue(f.num(scene.cycleCm, 1))}</dd></>}
                </>
              ) : (
                <>
                  <dt>{t.sheet.fields.compared}</dt><dd>{first} → {last}</dd>
                  <dt>{t.sheet.fields.interval}</dt><dd>{t.sheet.interval(days, laps)}</dd>
                </>
              )}
              <dt>{t.sheet.fields.pols}</dt><dd>{scene.polarizations.join(" + ")}</dd>
              {scene.facts.map((fact) => (<FactRow key={fact.label} label={fact.label} value={fact.value} />))}
            </dl>
          </section>

          {hasOrigin(scene) && (
            <section className="block">
              <h3 className="block__lead">{t.sheet.originLead}</h3>
              <dl className="record record--origin">
                {passOrigins(scene).map((p) => (
                  <div key={p.date}>
                    <dt>{p.referenceDate ? t.sheet.originPair(f.date(p.referenceDate), f.date(p.date)) : t.sheet.originPass(f.date(p.date))}{p.release && <small>{t.sheet.originRelease(t.map.release[p.release])}</small>}</dt>
                    <dd>{p.granule}</dd>
                  </div>
                ))}
                {whitePoints(scene).map((w) => (<div key={w.pol}><dt>{t.sheet.originWhite(w.pol)}</dt><dd>{t.sheet.originWhiteValue(f.num(w.db))}</dd></div>))}
                {/* no interferograma os vazios são transparentes (água ou sinal perdido num dos pares), e a legenda do divisor já diz */}
                {!phase && missingPct(scene) !== null && <div><dt>{t.sheet.originMissing}</dt><dd>{t.sheet.originMissingValue(f.num(missingPct(scene) ?? 0, 1))}</dd></div>}
              </dl>
            </section>
          )}

          <section className="block block--note">
            <h3 className="block__lead">{t.sheet.limitsLead}</h3>
            <p>{phase ? t.map.phaseNote : !real ? t.sheet.limitsExample : scene.imagery === "gcov" ? t.map.calibratedImage : t.map.realImage}</p>
          </section>

          {/* comparação entre cenas, só com os fatos reais de cada uma (as notas de exemplo saíram da tela) */}
          {!phase && ranked.length > 1 && (
            <section className="block">
              <h3 className="block__lead">{t.scenes.compare}</h3>
              <div className="chips" role="group" aria-label={t.scenes.compare}>
                {ranked.map(({ scene: s }) => (
                  <button key={s.id} type="button" aria-pressed={picked.includes(s.id)} aria-label={t.scenes.compareAria(s.name)} onClick={() => onTogglePick(s.id)}>{s.name}</button>
                ))}
              </div>
              {compare.length < 2 ? (
                <p className="muted">{t.scenes.compareEmpty}</p>
              ) : (
                <div className="scroll-x">
                  <table className="compare">
                    <thead><tr><th />{compare.map((s) => <th key={s.id}>{s.name}</th>)}</tr></thead>
                    <tbody>
                      {compare[0].facts.map((fact) => (
                        <tr key={fact.label}>
                          <th>{fact.label}</th>
                          {compare.map((s) => <td key={s.id}>{s.facts.find((x) => x.label === fact.label)?.value ?? t.scenes.noData}</td>)}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          )}
        </>
      )}

    </article>
  );
}

/** Área com dois ou três algarismos: a medida não sustenta mais que isso. */
function useKm() {
  const { f } = useI18n();
  return (v: number) => f.num(v < 10 ? Number(v.toPrecision(2)) : Number(v.toPrecision(3)), v < 10 && v > 0 ? 1 : 0);
}

/**
 * ATIVIDADE PARA A TURMA. Quatro passos, um por vez: cada um pede uma ação no mapa (o botão faz por quem está
 * projetando) e uma pergunta com a resposta escondida. A primeira resposta vem das medidas do próprio par em tela.
 */
function Activity({ scene, analysis, view, onView, onPlay, onPol }: {
  scene: Scene; analysis: MapAnalysis | null; view: View; onView(view: View): void; onPlay(): void; onPol(pol: Polarization): void;
}) {
  const { t, f } = useI18n();
  const km = useKm();
  const a = t.sheet.activity;
  const [step, setStep] = useState(0);
  const [guess, setGuess] = useState<"darker" | "brighter" | null>(null);
  const [open, setOpen] = useState<Record<number, boolean>>({});
  const hasHV = scene.polarizations.includes("HV");
  const from = scene.acquisitions[0].date, to = scene.acquisitions[scene.acquisitions.length - 1].date;
  const truth = analysis ? (analysis.fellKm2 >= analysis.roseKm2 ? "darker" : "brighter") : null;
  const even = analysis ? Math.max(analysis.fellKm2, analysis.roseKm2) < 0.005 * bboxAreaKm2(scene.bbox) : false;

  const reveal = (k: number, answer: ReactNode) => (
    open[k]
      ? <p className="activity__answer">{answer}</p>
      : <button type="button" className="action action--quiet" onClick={() => setOpen({ ...open, [k]: true })}>{a.reveal}</button>
  );

  const steps: { title: string; body: ReactNode }[] = [
    {
      title: a.predict.title,
      body: (
        <>
          <p>{a.predict.ask(f.date(from), f.date(to))}</p>
          <div className="activity__choice" role="group" aria-label={a.predict.title}>
            <button type="button" aria-pressed={guess === "darker"} onClick={() => setGuess("darker")}><i className="key key--changed" />{a.predict.darker}</button>
            <button type="button" aria-pressed={guess === "brighter"} onClick={() => setGuess("brighter")}><i className="key key--rose" />{a.predict.brighter}</button>
          </div>
          {guess && (analysis && truth ? (
            <div className="activity__answer">
              <p><b>{even ? a.predict.even : guess === truth ? a.predict.right : a.predict.wrong}</b> {a.predict.measured(km(analysis.fellKm2), km(analysis.roseKm2), f.num(analysis.ratio, 2))}</p>
              {analysis.example && <p className="muted">{a.exampleNote}</p>}
              <button type="button" className="action action--quiet" onClick={() => onView(view === "change" ? "swipe" : "change")}>{view === "change" ? t.sheet.seeSwipe : a.predict.show}</button>
            </div>
          ) : <p className="muted">{a.waitMap}</p>)}
        </>
      ),
    },
    {
      title: a.slide.title,
      body: (
        <>
          <p>{a.slide.ask}</p>
          <button type="button" className="action" onClick={onPlay}>{a.slide.play}</button>
          {reveal(1, <>{t.sheet.keys.dark} {t.sheet.keys.bright}</>)}
        </>
      ),
    },
    ...(hasHV ? [{
      title: a.pol.title,
      body: (
        <>
          <p>{a.pol.ask}</p>
          <div className="activity__choice" role="group" aria-label={a.pol.title}>
            {(["HH", "HV"] as const).map((p) => <button key={p} type="button" aria-pressed={analysis?.pol === p} onClick={() => onPol(p)}>{p}</button>)}
          </div>
          {reveal(2, t.sheet.how.canopy)}
        </>
      ),
    }] : []),
    {
      title: a.cloud.title,
      body: (
        <>
          <p>{a.cloud.ask}</p>
          {reveal(3, a.cloud.answer)}
        </>
      ),
    },
  ];
  const current = Math.min(step, steps.length - 1);

  return (
    <section className="activity">
      <ol className="activity__steps" aria-label={a.aria}>
        {steps.map((s, k) => (
          <li key={s.title}><button type="button" aria-pressed={k === current} aria-label={a.stepAria(k + 1, s.title)} onClick={() => setStep(k)}>{k + 1}</button></li>
        ))}
      </ol>
      <div className="activity__card" key={current}>
        <h3 className="block__lead">{steps[current].title}</h3>
        {steps[current].body}
      </div>
      <div className="activity__nav">
        <button type="button" className="ghost" onClick={() => setStep(current - 1)} disabled={current === 0}>{a.back}</button>
        <span>{a.progress(current + 1, steps.length)}</span>
        <button type="button" className="ghost" onClick={() => setStep(current + 1)} disabled={current === steps.length - 1}>{a.next}</button>
      </div>
    </section>
  );
}

// desenho do histograma, em unidades do viewBox
const HW = 340, HH = 150, HPAD = 4, HBASE = 124;

/**
 * MEDIR. O histograma da mudança entre as duas passagens, em dB, com o limiar que o mapa usa: arrastar o limiar muda
 * o mapa de mudança e as áreas, e a tabela mostra o quanto o número depende dele.
 */
function Measure({ scene, analysis, view, onView, onSensitivity }: {
  scene: Scene; analysis: MapAnalysis | null; view: View; onView(view: View): void; onSensitivity(value: number): void;
}) {
  const { t, f } = useI18n();
  const km = useKm();
  const m = t.sheet.measure;
  const svg = useRef<SVGSVGElement>(null);
  const dragging = useRef(false);
  if (!analysis) return <p className="muted">{m.wait}</p>;
  const { histogram: h, ratio } = analysis, db = ratioToDb(ratio);
  const max = Math.max(1, ...h.counts), bin = (HW - 2 * HPAD) / h.counts.length;
  const x = (value: number) => HPAD + ((value + h.rangeDb) / (2 * h.rangeDb)) * (HW - 2 * HPAD);
  // raiz da contagem: o pico em zero não esmaga as caudas, que são o que interessa
  const y = (count: number) => HBASE - Math.sqrt(count / max) * (HBASE - 10);
  const lo = ratioToDb(ratioFor(1)), hi = ratioToDb(ratioFor(0));

  function drag(e: PointerEvent<SVGSVGElement>) {
    if (!dragging.current || !svg.current) return;
    const box = svg.current.getBoundingClientRect();
    const value = (((e.clientX - box.left) / box.width) * HW - HPAD) / (HW - 2 * HPAD) * 2 * h.rangeDb - h.rangeDb;
    onSensitivity(sensitivityFor(dbToRatio(Math.max(lo, Math.min(hi, Math.abs(value))))));
  }

  return (
    <>
      <section className="block">
        <h3 className="block__lead">{m.lead}<small>{analysis.pol} · {f.shortDate(analysis.from)} → {f.shortDate(analysis.to)}</small></h3>
        <div className="measure__figures">
          <p><b className="figure__fell">{negligibleArea(analysis.fellKm2) ? t.map.fellNone : t.map.fell(km(analysis.fellKm2))}</b></p>
          <p><b className="figure__rose">{negligibleArea(analysis.roseKm2) ? t.map.roseNone : t.map.rose(km(analysis.roseKm2))}</b></p>
        </div>
        <svg ref={svg} className="histogram" viewBox={`0 0 ${HW} ${HH}`} role="img" aria-label={m.histogramAria(f.num(db, 1))}
          onPointerDown={(e) => { dragging.current = true; e.currentTarget.setPointerCapture?.(e.pointerId); drag(e); }}
          onPointerMove={drag} onPointerUp={() => { dragging.current = false; }} onPointerCancel={() => { dragging.current = false; }}>
          {/* a faixa que não conta como mudança */}
          <rect x={x(-db)} y={6} width={x(db) - x(-db)} height={HBASE - 6} className="histogram__quiet" />
          {h.counts.map((count, k) => {
            const center = -h.rangeDb + ((k + 0.5) / h.counts.length) * 2 * h.rangeDb;
            const side = center < -db ? "fell" : center > db ? "rose" : "same";
            return count ? <rect key={k} x={HPAD + k * bin + 0.5} y={y(count)} width={bin - 1} height={HBASE - y(count)} className={`histogram__bar histogram__bar--${side}`} /> : null;
          })}
          <line x1={HPAD} x2={HW - HPAD} y1={HBASE} y2={HBASE} className="histogram__axis" />
          {[-db, db].map((v) => (
            <g key={v} className="histogram__limit">
              <line x1={x(v)} x2={x(v)} y1={4} y2={HBASE} />
              <circle cx={x(v)} cy={8} r={5} />
            </g>
          ))}
          {[-h.rangeDb, -6, 0, 6, h.rangeDb].map((v) => (
            <text key={v} x={x(v)} y={HBASE + 15} textAnchor={v === -h.rangeDb ? "start" : v === h.rangeDb ? "end" : "middle"} className="histogram__tick">{v > 0 ? `+${v}` : v} dB</text>
          ))}
        </svg>
        <p className="muted">{m.histogramHint(f.num(db, 1), f.num(ratio, 2))}</p>
        <input type="range" min={0} max={1} step={0.02} value={sensitivityFor(ratio)} aria-label={t.map.sensitivityAria}
          className="measure__range" onChange={(e) => onSensitivity(Number(e.target.value))} />
        <button type="button" className="action" onClick={() => onView(view === "change" ? "swipe" : "change")}>{view === "change" ? t.sheet.seeSwipe : t.sheet.seeChange}</button>
      </section>

      <section className="block">
        <h3 className="block__lead">{m.tableLead}</h3>
        <table className="thresholds">
          <thead><tr><th>{m.threshold}</th><th>{m.darker}</th><th>{m.brighter}</th></tr></thead>
          <tbody>
            {analysis.table.map((row) => (
              <tr key={row.ratio} aria-selected={Math.abs(row.ratio - ratio) < 0.02}>
                <th><button type="button" onClick={() => onSensitivity(sensitivityFor(row.ratio))}>{f.num(row.ratio, 2)}× · {f.num(row.db, 1)} dB</button></th>
                <td>{km(row.fellKm2)} km²</td>
                <td>{km(row.roseKm2)} km²</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="muted">{m.tableHint}</p>
      </section>

      <section className="block block--note">
        <h3 className="block__lead">{m.methodLead}</h3>
        <p>{analysis.example ? m.methodExample : analysis.calibrated ? m.methodCalibrated : m.methodRelative}</p>
        {scene.waterSeries && <p>{m.notWater}</p>}
        {analysis.calibrated && <p>{m.probe}</p>}
      </section>
    </>
  );
}

function FactRow({ label, value }: { label: string; value: string }) {
  return (<><dt>{label}</dt><dd>{value}</dd></>);
}
