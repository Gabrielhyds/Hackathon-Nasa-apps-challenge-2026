import { useEffect, useRef } from "react";
import type { Scene } from "@nexxus/contract";
import { useI18n } from "../i18n";
import { LABS, type Lab as LabId } from "../lib/urlState";
import { FringeLab } from "./FringeLab";
import { Hydrograph } from "./Hydrograph";
import { PulseLab } from "./PulseLab";

interface Props {
  panel: LabId;
  /** A cena cujo hidrograma aparece. Sem ela (ainda carregando, ou cena sem série), a aba avisa. */
  scene: Scene | undefined;
  loading: boolean;
  /** As cenas não carregaram: a aba do hidrograma diz isso e oferece tentar de novo, em vez de dizer que a cena não tem série. */
  failed: boolean;
  onRetry(): void;
  onPanel(panel: LabId): void;
  onClose(): void;
}

/**
 * O laboratório: uma folha de vidro por cima do mapa com as três peças que vão além do antes e depois.
 * O hidrograma mede a enchente passagem a passagem; as outras duas abrem o radar por dentro.
 */
export function Lab({ panel, scene, loading, failed, onRetry, onPanel, onClose }: Props) {
  const { t } = useI18n();
  const body = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  useEffect(() => { body.current?.scrollTo({ top: 0 }); body.current?.focus({ preventScroll: true }); }, [panel]);

  return (
    <section className="lab glass" role="dialog" aria-label={t.lab.aria}>
      <header className="lab__bar">
        <div className="tabs lab__tabs" role="tablist" aria-label={t.lab.aria}>
          {LABS.map((id) => (
            <button key={id} type="button" role="tab" id={`lab-${id}`} aria-selected={panel === id} aria-controls="lab-body" onClick={() => onPanel(id)}>{t.lab.tabs[id]}</button>
          ))}
        </div>
        <button type="button" className="ghost lab__close" onClick={onClose}>{t.lab.close}</button>
      </header>
      <div className="lab__body" id="lab-body" ref={body} role="tabpanel" aria-labelledby={`lab-${panel}`} tabIndex={-1} key={panel}>
        {panel === "hydro" && (scene?.waterSeries ? <Hydrograph scene={scene} />
          : failed ? (
            <div className="stack stack--tight">
              <p className="muted">{t.scenes.error}</p>
              <button type="button" className="link" onClick={onRetry}>{t.scenes.retry}</button>
            </div>
          ) : <p className="muted">{loading ? t.scenes.loading : t.lab.hydro.none}</p>)}
        {panel === "pulse" && <PulseLab />}
        {panel === "fringes" && <FringeLab />}
      </div>
    </section>
  );
}
