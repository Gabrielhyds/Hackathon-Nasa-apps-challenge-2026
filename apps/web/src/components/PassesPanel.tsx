import type { CSSProperties } from "react";
import type { Pass, Place, Scene } from "@nexxus/contract";
import { useI18n } from "../i18n";
import type { Audience } from "../lib/audience";
import { placeLabel } from "../lib/format";
import { NISAR, distanceKm } from "../lib/geo";
import { nextPasses } from "../lib/nextPass";

interface Props {
  place: Place | null;
  /** Quem explora vê só data e órbita; quem ensina já encontra o glossário aberto. */
  audience: Audience;
  passes: Pass[] | undefined;
  loading: boolean;
  failed: boolean;
  /** Passagens inventadas: no modo de exemplo, ou porque a API não alcançou o catálogo da NASA. */
  example: "mock" | "fallback" | null;
  scenes: Scene[];
  onRetry(): void;
  onOpenScene(id: string): void;
}

export function PassesPanel({ place, audience, passes, loading, failed, example, scenes, onRetry, onOpenScene }: Props) {
  const { t, f } = useI18n();
  if (!place) {
    return (
      <div className="stack">
        <p className="lead">{t.passes.emptyLead}</p>
        <p className="muted">{t.passes.emptyBody(NISAR.repeatDays)}</p>
      </div>
    );
  }
  const nearest = scenes
    .map((s) => ({ s, km: distanceKm([place.lon, place.lat], [s.lon, s.lat]) }))
    .sort((a, b) => a.km - b.km)[0];

  const upcoming = passes ? nextPasses(passes) : [];

  return (
    <div className="stack">
      <header>
        <h2 className="title">{placeLabel(place)}</h2>
        {passes && passes.length > 0 && (
          <p className="meta">
            {t.passes.count(passes.length, f.date(passes[0].date))}{example === "mock" ? ` · ${t.passes.example}` : ""}
          </p>
        )}
        {passes && passes.length > 0 && example === "fallback" && (
          <p className="meta">{t.passes.exampleFallback} <button type="button" className="link" onClick={onRetry}>{t.passes.retry}</button></p>
        )}
        {place.kind !== "city" && <p className="meta">{t.passes.region(place.name)}</p>}
      </header>

      {loading && <p className="muted">{t.passes.loading}</p>}
      {failed && (
        <div className="stack stack--tight">
          <p className="muted">{t.passes.error}</p>
          <button type="button" className="link" onClick={onRetry}>{t.passes.retry}</button>
        </div>
      )}
      {passes && passes.length === 0 && (
        <p className="muted">{t.passes.none}</p>
      )}

      {upcoming.length > 0 && (
        <section className="next">
          <h3>{t.passes.next}</h3>
          <p className="next__when"><b>{f.date(upcoming[0].date)}</b><span>{t.passes.nextWhen(upcoming[0].inDays)}</span></p>
          <ul>
            {upcoming.map((n) => (
              <li key={n.direction}><span className={`dot dot--${n.direction}`} />{t.passes.direction[n.direction]} · {f.date(n.date)}</li>
            ))}
          </ul>
          <p className="meta">{t.passes.nextNote(NISAR.repeatDays)}</p>
        </section>
      )}

      {passes && passes.length > 0 && (
        <>
          <Timeline passes={passes} />
          <div className="scroll-x">
            <table className={audience === "explore" ? "passes passes--plain" : "passes"}>
              <thead><tr>{t.passes.columns.map((c) => <th key={c}>{c}</th>)}</tr></thead>
              <tbody>
                {passes.map((p, i) => (
                  <tr key={`${p.date}-${p.direction}-${p.track}`} style={{ "--i": i } as CSSProperties}>
                    <td>{f.date(p.date)}</td>
                    <td><span className={`dot dot--${p.direction}`} />{t.passes.direction[p.direction]}</td>
                    <td>{p.track} / {p.frame}</td>
                    <td>{p.polarization}</td>
                    <td>{p.product}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="meta">{t.passes.swath(NISAR.swathKm)}</p>
          <details className="fold">
            <summary>{t.passes.glossary}</summary>
            <dl className="glossary">
              {t.passes.terms.map((x) => (<div key={x.term}><dt>{x.term}</dt><dd>{x.text}</dd></div>))}
            </dl>
          </details>
        </>
      )}

      {nearest && (
        <button type="button" className="link" onClick={() => onOpenScene(nearest.s.id)}>
          {nearest.km < 150 ? t.passes.nearestNear : t.passes.nearestFar}: {t.passes.nearestTail(nearest.s.name, f.num(nearest.km))}
        </button>
      )}
    </div>
  );
}

/** Linha do tempo: ascendentes acima do eixo, descendentes abaixo. */
function Timeline({ passes }: { passes: Pass[] }) {
  const { t, f } = useI18n();
  const W = 400, H = 76, pad = 8;
  const times = passes.map((p) => Date.parse(p.date));
  const min = Math.min(...times), max = Math.max(...times), span = Math.max(1, max - min);
  const x = (t: number) => pad + ((t - min) / span) * (W - pad * 2);
  const first = passes[passes.length - 1], last = passes[0];
  return (
    <figure className="timeline">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={t.passes.timelineAria(f.date(first.date), f.date(last.date))}>
        <line x1={pad} x2={W - pad} y1={H / 2} y2={H / 2} className="timeline__axis" />
        {passes.map((p, i) => {
          const up = p.direction === "ascending", px = x(Date.parse(p.date));
          return (
            <g key={`${p.date}-${p.direction}-${p.track}`} className={up ? "timeline__asc" : "timeline__desc"} style={{ "--i": passes.length - 1 - i } as CSSProperties}>
              <line x1={px} x2={px} y1={H / 2} y2={up ? 16 : H - 16} />
              <circle cx={px} cy={up ? 16 : H - 16} r={3.5}><title>{`${f.date(p.date)} · ${t.passes.direction[p.direction]}`}</title></circle>
            </g>
          );
        })}
      </svg>
      <figcaption>
        <span>{f.shortDate(first.date)}</span>
        <span><i className="dot dot--ascending" />{t.passes.direction.ascending} <i className="dot dot--descending" />{t.passes.direction.descending}</span>
        <span>{f.shortDate(last.date)}</span>
      </figcaption>
    </figure>
  );
}
