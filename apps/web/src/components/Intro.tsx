import { useEffect } from "react";
import { useI18n } from "../i18n";

interface Props {
  /** Abre a primeira cena. */
  onStart(): void;
  /** Fecha e deixa só o globo. */
  onClose(): void;
}

/** Abertura da primeira visita: o que é o Nexxus, escrito sobre o globo girando, e um jeito de começar. */
export function Intro({ onStart, onClose }: Props) {
  const { t } = useI18n();
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <section className="hero" aria-label={t.welcome.aria}>
      <p className="hero__kicker">{t.cover.mission}</p>
      <h2 className="hero__title">{t.welcome.title}</h2>
      <p className="hero__body">{t.welcome.body}</p>
      <p className="hero__go">
        <button type="button" className="cta" onClick={onStart}>{t.welcome.start}</button>
        <button type="button" className="ghost" onClick={onClose}>{t.welcome.skip}</button>
      </p>
    </section>
  );
}
