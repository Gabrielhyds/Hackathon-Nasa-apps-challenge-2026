import { useEffect, useRef, useState } from "react";
import type { Scene } from "@nexxus/contract";
import { useI18n } from "../i18n";
import { eventsFirst, type RankedScene } from "../lib/ranking";
import { reduceMotion } from "../lib/motion";
import { syntheticSeries } from "../lib/speckle";

/** Miniatura da cena: a passagem mais recente, na primeira polarização. A real, se houver, ou a de exemplo. Guardada para não redesenhar. */
const thumbs = new Map<string, string>();
export function thumb(scene: Scene): string {
  const pol = scene.polarizations[0] ?? "HH", n = scene.acquisitions.length;
  const real = scene.acquisitions[n - 1]?.images[pol];
  if (real) return real;
  let url = thumbs.get(scene.id);
  if (!url) { url = syntheticSeries(scene.id, scene.change, pol, n, 104).frames[n - 1].toDataURL(); thumbs.set(scene.id, url); }
  return url;
}

interface Props {
  ranked: RankedScene[];
  selectedId: string | null;
  hoverId: string | null;
  onSelect(id: string): void;
  onHover(id: string | null): void;
}

/**
 * Carrossel de cenas na base da tela: um cartão por cena, com a imagem de radar. Abre só com os eventos documentados;
 * as mudanças sazonais ficam atrás do cartão "Mais cenas", que as abre e recolhe e faz as vezes de rótulo do grupo.
 * Se a cena aberta é uma delas (por um link, pelo mapa ou pelo agente), o grupo abre sozinho. Sem nota no cartão:
 * as notas são de exemplo.
 */
export function SceneIndex({ ranked, selectedId, hoverId, onSelect, onHover }: Props) {
  const { t } = useI18n();
  const { events, others } = eventsFirst(ranked);
  const list = useRef<HTMLOListElement>(null);
  // sem evento documentado não há o que pôr na frente: mostra tudo, sem o cartão de abrir
  const foldable = events.length > 0 && others.length > 0;
  const [expanded, setExpanded] = useState(false);
  const selectedIsOther = others.some((r) => r.scene.id === selectedId);
  // também ao ir de uma sazonal para outra, com o grupo recolhido no meio do caminho
  useEffect(() => { if (selectedIsOther) setExpanded(true); }, [selectedIsOther, selectedId]);
  const showOthers = !foldable || expanded;
  // há cartões escondidos de cada lado? Decide se as setas aparecem
  const [more, setMore] = useState({ left: false, right: false });
  useEffect(() => {
    const el = list.current;
    if (!el) return;
    const check = () => {
      const left = el.scrollLeft > 4, right = el.scrollLeft + el.clientWidth < el.scrollWidth - 4;
      setMore((old) => (old.left === left && old.right === right ? old : { left, right }));
    };
    check();
    el.addEventListener("scroll", check, { passive: true });
    const watch = new ResizeObserver(check);
    watch.observe(el);
    return () => { el.removeEventListener("scroll", check); watch.disconnect(); };
  }, [ranked.length, showOthers]);
  /** Anda uns três cartões para o lado pedido. */
  const move = (side: 1 | -1) => list.current?.scrollBy({ left: side * Math.max(320, list.current.clientWidth * 0.6), behavior: reduceMotion() ? "auto" : "smooth" });
  const card = ({ scene }: RankedScene) => (
    <li key={scene.id} data-scene={scene.id}>
      <button type="button" aria-pressed={scene.id === selectedId}
        className={scene.id === hoverId && scene.id !== selectedId ? "card is-hover" : "card"}
        style={{ backgroundImage: `url(${thumb(scene)})` }}
        onClick={() => onSelect(scene.id)}
        onMouseEnter={() => onHover(scene.id)} onMouseLeave={() => onHover(null)}
        onFocus={() => onHover(scene.id)} onBlur={() => onHover(null)}>
        <span className="card__text"><b>{scene.name}</b><i>{scene.basis === "documented-event" ? scene.event : scene.region}</i></span>
      </button>
    </li>
  );
  return (
    <nav className="strip" aria-label={t.cover.index}>
      {/* setas só quando há cartões fora da tela: sem elas não dá para saber que a lista continua */}
      {more.left && <button type="button" className="strip__more strip__more--left" aria-label={t.cover.earlier} title={t.cover.earlier} onClick={() => move(-1)}>‹</button>}
      {more.right && <button type="button" className="strip__more strip__more--right" aria-label={t.cover.later} title={t.cover.later} onClick={() => move(1)}>›</button>}
      <ol ref={list}>
        {events.map(card)}
        {foldable && (
          <li>
            <button type="button" className="card card--more" aria-expanded={expanded} onClick={() => setExpanded((on) => !on)}>
              <span className="card__text"><b>{expanded ? t.cover.seasonalGroup : t.cover.more}</b><i>{expanded ? t.cover.fewer : t.cover.moreCount(others.length)}</i></span>
            </button>
          </li>
        )}
        {showOthers && others.map(card)}
      </ol>
    </nav>
  );
}
