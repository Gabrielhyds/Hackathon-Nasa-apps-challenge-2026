import { useState } from "react";
import { useI18n } from "../i18n";
import { METRICS, rate, report, usePerf, type MetricId } from "../lib/perf";

/** Métricas que não são tempo: uma razão sem unidade e uma contagem. */
const PLAIN: Partial<Record<MetricId, number>> = { cls: 3, longTasks: 0 };

/** Painel de desempenho, ligado por ?perf=1: as medidas desta visita, com a avaliação de cada uma. */
export function PerfPanel() {
  const { t, f } = useI18n();
  const samples = usePerf();
  const [open, setOpen] = useState(true);
  const [copy, setCopy] = useState<"idle" | "done" | "failed">("idle");
  const show = (id: MetricId, value: number) => (id in PLAIN ? f.num(value, PLAIN[id]) : value >= 1000 ? `${f.num(value / 1000, 2)} s` : `${f.num(value, value < 10 ? 1 : 0)} ms`);

  function copyReport() {
    const text = JSON.stringify({ url: window.location.href, at: new Date().toISOString(), metrics: report(samples) }, null, 2);
    navigator.clipboard.writeText(text).then(() => setCopy("done"), () => setCopy("failed"));
  }

  if (!open) return <aside className="perf perf--closed glass"><button type="button" onClick={() => setOpen(true)}>{t.perf.show}</button></aside>;
  return (
    <aside className="perf glass" aria-label={t.perf.aria}>
      <header className="perf__head"><h2>{t.perf.title}</h2><button type="button" onClick={() => setOpen(false)}>{t.perf.hide}</button></header>
      <ul className="perf__list">
        {METRICS.map((id) => {
          const s = samples.get(id), text = t.perf.metrics[id];
          if (!s) return <li key={id} className="is-waiting" title={text.hint}><i /><span>{text.name}</span><b>{t.perf.waiting}</b></li>;
          const rating = rate(id, s.value);
          return (
            <li key={id} className={`is-${rating}`} title={`${text.hint} (${t.perf.rating[rating]})`}>
              <i /><span>{text.name}</span>
              <b>{show(id, s.value)}{s.count > 1 && s.worst > s.value && <small>{t.perf.worst(show(id, s.worst))} · {t.perf.times(s.count)}</small>}</b>
            </li>
          );
        })}
      </ul>
      <footer className="perf__foot">
        <button type="button" onClick={copyReport}>{t.perf.copy}</button>
        <span role="status">{copy === "done" ? t.perf.copied : copy === "failed" ? t.perf.copyFailed : ""}</span>
      </footer>
      <p className="perf__note">{t.perf.note}</p>
    </aside>
  );
}
