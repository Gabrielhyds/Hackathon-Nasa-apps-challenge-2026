import { useEffect, useMemo, useRef, useState } from "react";
import type { Scene, WaterSample } from "@nexxus/contract";
import { useI18n } from "../i18n";
import { axisMax, chartSpan, dailyWithin, dayNumber, daysApart, gaugeDays, isoDay, nearest, opticalGap, orbitLinks, peakSample, referenceRange, timeFraction, usualRevisit } from "../lib/hydro";
import { reduceMotion } from "../lib/motion";

/**
 * Miniaturas e mapas que acompanham a página, gerados por scripts/hydrograph.py. A chave é o nome do arquivo sem
 * extensão. As miniaturas das passagens são o preview do NISAR: servem para ver; a medida vem de `scene.waterSeries`.
 */
const FILES = import.meta.glob<string>("../assets/hydro/*", { eager: true, query: "?url", import: "default" });
const IMAGES: Record<string, string> = Object.fromEntries(Object.entries(FILES).map(([path, url]) => [path.split("/").pop()!.replace(/\.\w+$/, ""), url]));

// desenho do gráfico, em unidades do viewBox
const W = 920, H = 470, LEFT = 44, RIGHT = 20, SKY = 14, RAIN_TOP = 30, RAIN_H = 56, TOP = 122, ZERO = 432;
const RAIN_MAX = 80;

/**
 * A régua de cheia de uma cena: a água aberta nova em cada passagem (`waterSeries`, do dado calibrado), as leituras
 * do nível do rio (`riverGauge`) e, quando há, o contexto independente (`floodContext`: chuva, óptico, OPERA).
 * Só para cena com `waterSeries`. O mapa OPERA fica fora do eixo: ele conta toda a água aberta, não só a nova.
 */
export function Hydrograph({ scene, onPass }: { scene: Scene; /** A passagem escolhida mudou: o mapa mostra a imagem dela, se a cena a tiver. */ onPass?(date: string): void }) {
  const { t, f } = useI18n();
  const series = scene.waterSeries!, samples = series.samples, context = scene.floodContext;
  const peak = useMemo(() => peakSample(samples), [samples]);
  const [selected, setSelected] = useState(peak.date);
  const [playing, setPlaying] = useState(false);
  const [discharge, setDischarge] = useState(false);
  /** Uma parte por vez: o gráfico, a conferência com fontes independentes ou o método. */
  const index = Math.max(0, samples.findIndex((s) => s.date === selected));
  const pass = samples[index];

  // a passagem escolhida comanda o mapa; não ao abrir, para não mexer no par que a pessoa deixou na cena
  // (a última data avisada fica guardada: em desenvolvimento o efeito roda duas vezes ao montar);
  // clicar na passagem que já está escolhida, como o pico ao abrir, também leva o mapa até ela
  const told = useRef(selected), notify = useRef(onPass);
  notify.current = onPass;
  useEffect(() => {
    if (told.current === selected) return;
    told.current = selected;
    notify.current?.(selected);
  }, [selected]);
  /** O mapa tem imagem desta passagem? Só das que estão na série da cena. */
  const onMap = scene.acquisitions.some((a) => a.date === pass.date);

  // tocar: uma passagem por vez, do começo ao fim
  useEffect(() => {
    if (!playing) return;
    const timer = setInterval(() => {
      setSelected((current) => {
        const i = samples.findIndex((s) => s.date === current);
        if (i >= samples.length - 1) { setPlaying(false); return current; }
        return samples[i + 1].date;
      });
    }, reduceMotion() ? 1400 : 700);
    return () => clearInterval(timer);
  }, [playing, samples]);

  const span = useMemo(() => chartSpan(samples, context), [samples, context]);
  // em tela estreita o gráfico é mais largo que a tela e rola de lado: abre com o pico no meio, não no começo da série
  const chart = useRef<HTMLElement>(null);
  useEffect(() => {
    const el = chart.current;
    if (!el || el.scrollWidth <= el.clientWidth) return;
    const at = (LEFT + timeFraction(span, peak.date) * (W - LEFT - RIGHT)) / W;
    el.scrollLeft = Math.max(0, at * el.scrollWidth - el.clientWidth / 2);
  }, [span, peak]);
  const max = axisMax(samples);
  const x = (iso: string) => LEFT + timeFraction(span, iso) * (W - LEFT - RIGHT);
  const y = (km2: number) => ZERO - (km2 / max) * (ZERO - TOP);
  const inSpan = (iso: string) => iso >= span.start && iso <= span.end;
  const day = (W - LEFT - RIGHT) / daysApart(span.start, span.end);
  const months = useMemo(() => {
    const out: string[] = [];
    for (let d = dayNumber(span.start); d <= dayNumber(span.end); d++) if (isoDay(d).endsWith("-01")) out.push(isoDay(d));
    return out;
  }, [span]);
  const rain = context ? dailyWithin(context.rainMm, context.start, span) : [];
  const flow = context ? dailyWithin(context.dischargeM3s, context.start, span) : [];
  const maxQ = Math.max(1, ...flow.map((q) => q.value ?? 0));
  const qPath = flow.filter((q) => q.value !== null).map((q) => `${x(q.date)},${ZERO - ((q.value ?? 0) / maxQ) * (ZERO - TOP)}`).join(" ");
  const grid = Array.from({ length: Math.floor(max / 20) + 1 }, (_, k) => k * 20);
  const gauge = gaugeDays(scene.riverGauge ?? []).filter((g) => inSpan(g.date));
  const level = (m: number) => f.num(m, Number.isInteger(m) ? 0 : String(m).split(".")[1].length);
  // no gráfico cabe só o começo do lugar ("Lajeado"); o texto inteiro vai na dica e no cartão
  const shortPlace = (place: string) => place.split(",")[0];

  const floor = referenceRange(samples, pass.track);
  // a imagem calibrada desta passagem, se ela é uma das que a cena compara e a API mandou a imagem real
  const peakSharp = scene.acquisitions.find((a) => a.date === peak.date)?.images.HH ?? null;
  const optical = context ? nearest(context.optical, pass.date) : null;
  const gap = context ? opticalGap(context, peak.date) : null;
  const operaBefore = context?.independent.filter((o) => o.date < peak.date).pop(), operaAfter = context?.independent.find((o) => o.date > peak.date);
  const firstHls = context?.maps.hls[0], hlsCloud = context?.optical.find((o) => o.date === firstHls)?.cloudPct;

  function start() {
    if (index >= samples.length - 1) setSelected(samples[0].date);
    setPlaying(true);
  }
  const step = (by: number) => { setPlaying(false); setSelected(samples[Math.max(0, Math.min(samples.length - 1, index + by))].date); };

  return (
    <div className="hydro">
      <header className="lab__intro">
        <div><p className="lab__kicker">{t.lab.hydro.kicker(scene.name)}</p><h2 className="lab__title">{t.lab.hydro.title}</h2></div>
        <p className="lab__lead">{t.lab.brief.hydro(samples.length, usualRevisit(samples))}</p>
      </header>

      {/* sem sub-abas: o gráfico, a conferência logo abaixo e o método recolhido no fim */}
      <div className="hydro__main">
        <figure className="hydro__chart" ref={chart}>
          <svg viewBox={`0 0 ${W} ${H}`} role="group" aria-label={t.lab.hydro.chartAria(samples.length, f.date(peak.date), f.num(peak.newWaterKm2, 0))}>
            {context && (
              <>
                {/* céu: os dias em que um satélite óptico cobriu o vale */}
                <text x={0} y={SKY + 4} className="hydro__axis">{t.lab.hydro.optical}</text>
                {context.optical.filter((o) => inSpan(o.date)).map((o) => (
                  <circle key={o.date} cx={x(o.date)} cy={SKY} r={4} className={o.cloudPct < 50 ? "hydro__sky hydro__sky--clear" : "hydro__sky"}>
                    <title>{t.lab.hydro.opticalDay(f.shortDate(o.date), o.cloudPct)}</title>
                  </circle>
                ))}
                {/* chuva, pendurada de cima como nos hidrogramas */}
                <text x={0} y={RAIN_TOP + 12} className="hydro__axis">{t.lab.hydro.rain}</text>
                <line x1={LEFT} x2={W - RIGHT} y1={RAIN_TOP} y2={RAIN_TOP} className="hydro__grid" />
                {rain.map((r) => (r.value ? <rect key={r.date} x={x(r.date) - day * 0.36} y={RAIN_TOP} width={day * 0.72} height={Math.min(RAIN_H, (r.value / RAIN_MAX) * RAIN_H)} className="hydro__rain" /> : null))}
                <text x={W - RIGHT} y={RAIN_TOP + RAIN_H + 2} textAnchor="end" className="hydro__axis">{t.lab.hydro.rainScale(RAIN_MAX)}</text>
              </>
            )}
            {/* escala de água */}
            {grid.map((v) => (
              <g key={v}>
                <line x1={LEFT} x2={W - RIGHT} y1={y(v)} y2={y(v)} className={v ? "hydro__grid" : "hydro__zero"} />
                <text x={LEFT - 8} y={y(v) + 4} textAnchor="end" className="hydro__axis">{v}</text>
              </g>
            ))}
            <text x={0} y={TOP - 8} className="hydro__axis">{t.lab.hydro.axisWater}</text>
            {months.map((iso) => (
              <g key={iso}>
                <line x1={x(iso)} x2={x(iso)} y1={ZERO} y2={ZERO + 6} className="hydro__zero" />
                <text x={x(iso) + 4} y={ZERO + 20} className="hydro__axis">{f.shortDate(iso).slice(3)}</text>
              </g>
            ))}
            {/* vazão modelada, só quando pedida */}
            {discharge && <polyline points={qPath} className="hydro__discharge" />}
            {/* nível do rio: uma linha por dia de leitura; o rótulo vai para a esquerda quando há outro dia logo depois */}
            {gauge.map((g, i) => {
              const left = i < gauge.length - 1 && daysApart(g.date, gauge[i + 1].date) <= 6;
              return (
                <g key={g.date} className="hydro__gauge">
                  <line x1={x(g.date)} x2={x(g.date)} y1={TOP - 4} y2={ZERO} />
                  {g.readings.map((r, k) => (
                    <text key={k} x={x(g.date) + (left ? -6 : 6)} y={TOP + 6 + k * 14} textAnchor={left ? "end" : "start"}>
                      {t.lab.hydro.gaugeMark(level(r.levelM), shortPlace(r.place))}
                      <title>{t.lab.hydro.gaugeTitle(level(r.levelM), r.place, t.lab.hydro.gauge.when(f.date(r.date), r.time))}</title>
                    </text>
                  ))}
                </g>
              );
            })}
            {/* ligação só dentro da mesma órbita e de um ciclo: entre duas passagens o radar não viu nada */}
            {orbitLinks(samples).map(([a, b]) => (
              <line key={`${a.date}-${b.date}`} x1={x(a.date)} y1={y(a.newWaterKm2)} x2={x(b.date)} y2={y(b.newWaterKm2)} className="hydro__link" />
            ))}
            {samples.map((s) => {
              const on = s.date === selected;
              return (
                <g key={s.date} className={`hydro__pass hydro__pass--${s.direction}${on ? " is-on" : ""}${s.reference ? " is-ref" : ""}`} role="button" tabIndex={0} aria-pressed={on}
                  aria-label={t.lab.hydro.passAria(f.date(s.date), f.num(s.newWaterKm2, 1))}
                  onPointerEnter={() => { if (!playing) setSelected(s.date); }} onClick={() => { setPlaying(false); setSelected(s.date); if (s.date === selected) notify.current?.(s.date); }} onFocus={() => setSelected(s.date)}
                  onKeyDown={(e) => { if (e.key === "ArrowRight") step(1); if (e.key === "ArrowLeft") step(-1); }}>
                  <rect x={x(s.date) - 9} y={TOP - 10} width={18} height={ZERO - TOP + 10} className="hydro__hit" />
                  <line x1={x(s.date)} x2={x(s.date)} y1={ZERO} y2={y(s.newWaterKm2)} />
                  {s.lowKm2 !== undefined && s.highKm2 !== undefined && <line x1={x(s.date)} x2={x(s.date)} y1={y(s.lowKm2)} y2={y(s.highKm2)} className="hydro__range" />}
                  {on && <circle cx={x(s.date)} cy={y(s.newWaterKm2)} r={11} className="hydro__ring" />}
                  <circle cx={x(s.date)} cy={y(s.newWaterKm2)} r={on ? 6.5 : 5} className="hydro__dot" />
                </g>
              );
            })}
          </svg>
          <figcaption className="hydro__legend">
            <span><i className="dot" />{t.lab.hydro.legend.descending}</span>
            <span><i className="dot dot--ascending" />{t.lab.hydro.legend.ascending}</span>
            <span><i className="dot dot--hollow" />{t.lab.hydro.legend.reference}</span>
            <span><i className="mark mark--range" />{t.lab.hydro.legend.range}</span>
            {gauge.length > 0 && <span><i className="mark mark--gauge" />{t.lab.hydro.legend.gauge}</span>}
            {context && <label className="check"><input type="checkbox" checked={discharge} onChange={(e) => setDischarge(e.target.checked)} />{t.lab.hydro.legend.discharge}</label>}
          </figcaption>
        </figure>

        {/* o cartão não leva imagem: a passagem escolhida aparece no mapa ao lado, quando a cena a tem na série */}
        <aside className="hydro__pass-card" aria-live="polite">
          <div className="hydro__when">
            <b>{f.date(pass.date)}<span className="hydro__count">{index + 1} / {samples.length}</span></b>
            <span>{t.lab.hydro.pass.orbit(t.passes.direction[pass.direction], pass.track)}</span>
          </div>
          <p className="hydro__figure"><b>{f.num(pass.newWaterKm2, 1)} km²</b><span>{t.lab.hydro.pass.water}</span></p>
          <ul className="hydro__facts">
            {pass.lowKm2 !== undefined && pass.highKm2 !== undefined && <li>{t.lab.hydro.pass.range(f.num(pass.lowKm2, 1), f.num(pass.highKm2, 1))}</li>}
            {pass.reference ? <li>{t.lab.hydro.pass.reference}</li> : floor && <li>{t.lab.hydro.pass.floor(f.num(floor.low, 1), f.num(floor.high, 1))}</li>}
            {context && <li>{optical && Math.abs(optical.days) <= 2 ? t.lab.hydro.pass.opticalNear(f.shortDate(optical.item.date), optical.item.cloudPct) : t.lab.hydro.pass.opticalNone}</li>}
          </ul>
          <p className={onMap ? "hydro__note hydro__note--on" : "hydro__note"}>{onMap ? t.lab.hydro.pass.onMap : t.lab.hydro.pass.noMap}</p>
          <div className="hydro__transport">
            <button type="button" className="scrub__play" onClick={() => (playing ? setPlaying(false) : start())} aria-label={playing ? t.lab.hydro.pause : t.lab.hydro.play}>{playing ? "❚❚" : "▶"}</button>
            <button type="button" className="ghost" onClick={() => step(-1)} disabled={index === 0}>{t.lab.hydro.prev}</button>
            <button type="button" className="ghost" onClick={() => step(1)} disabled={index === samples.length - 1}>{t.lab.hydro.next}</button>
          </div>
        </aside>
      </div>

      {(scene.riverGauge?.length || context) && (
        <section className="checks">
          <h3 className="lab__sub">{t.lab.hydro.checksLead}</h3>
          <div className="checks__grid">
            {scene.riverGauge && scene.riverGauge.length > 0 && (
              <article className="check-card">
                <h4>{t.lab.hydro.gauge.title}</h4>
                {scene.riverGauge.map((g, i) => (
                  <div key={i} className="check-card__reading">
                    <p className="check-card__big">{level(g.levelM)} m<small>{t.lab.hydro.gauge.when(f.date(g.date), g.time)}{g.trend && ` · ${t.lab.hydro.gauge.trend[g.trend]}`}</small></p>
                    <p>{g.place}</p>
                    {g.floodLevelM !== undefined && <p>{t.lab.hydro.gauge.over(f.num(g.levelM - g.floodLevelM, 1), level(g.floodLevelM))}</p>}
                    <p className="check-card__src"><a href={g.source.url} target="_blank" rel="noreferrer">{g.source.title}</a></p>
                  </div>
                ))}
              </article>
            )}
            {context && (
              <article className="check-card">
                <h4>{t.lab.hydro.opera.title}</h4>
                <div className="check-card__maps">
                  {context.maps.opera.map((d) => {
                    const value = context.independent.find((o) => o.date === d);
                    return (
                      <figure key={d}>
                        {IMAGES[`opera-${d}`] && <img src={IMAGES[`opera-${d}`]} alt={t.lab.hydro.opera.alt(f.date(d))} />}
                        <figcaption><b>{f.shortDate(d)}</b>{value && ` · ${t.lab.hydro.opera.caption(f.num(value.waterKm2, 1))}`}</figcaption>
                      </figure>
                    );
                  })}
                </div>
                {operaBefore && operaAfter && <p>{t.lab.hydro.opera.body(f.shortDate(operaBefore.date), f.shortDate(operaAfter.date), f.shortDate(peak.date), daysApart(peak.date, operaAfter.date))}</p>}
                <p className="check-card__src">OPERA DSWx-S1 · NASA JPL · GIBS</p>
              </article>
            )}
            {context && firstHls && gap && (
              <article className="check-card">
                <h4>{t.lab.hydro.hls.title}</h4>
                <div className="check-card__maps check-card__maps--one">
                  <figure>
                    {IMAGES[`hls-${firstHls}`] && <img src={IMAGES[`hls-${firstHls}`]} alt={t.lab.hydro.hls.alt(f.date(firstHls))} />}
                    <figcaption><b>{f.shortDate(firstHls)}</b>{hlsCloud !== undefined && ` · ${t.lab.hydro.hls.cloud(hlsCloud)}`}</figcaption>
                  </figure>
                  <figure>
                    {/* ao lado do óptico, a calibrada do pico quando a API a manda; senão, o preview, que neste tamanho serve */}
                    {(peakSharp ?? IMAGES[peak.date]) && <img src={peakSharp ?? IMAGES[peak.date]} alt={t.lab.hydro.pass.imageAlt(f.date(peak.date))} />}
                    <figcaption><b>{f.shortDate(peak.date)}</b> · NISAR</figcaption>
                  </figure>
                </div>
                <p>{gap.before && gap.after && gap.days ? t.lab.hydro.hls.body(f.shortDate(gap.before), f.shortDate(gap.after), gap.days) : t.lab.hydro.hls.bodyOpen}</p>
                <p className="check-card__src">HLS (Landsat + Sentinel-2) · NASA GIBS</p>
              </article>
            )}
          </div>
        </section>
      )}

      <details className="fold">
        <summary>{t.lab.sections.method}</summary>
        <h3 className="lab__sub">{t.lab.hydro.limitsLead}</h3>
        <p className="lab__lead">{t.lab.hydro.lead(samples.length, usualRevisit(samples))} {t.lab.hydro.anywhere}</p>
        <ul className="notes notes--grid">
          <li>{series.method}</li>
          <li>{t.lab.hydro.limits.notFlooded}</li>
          <li>{t.lab.hydro.limits.notChange}</li>
          <li>{t.lab.hydro.limits.stops}</li>
          {context && <li>{t.lab.hydro.limits.context}</li>}
        </ul>
      </details>
    </div>
  );
}
