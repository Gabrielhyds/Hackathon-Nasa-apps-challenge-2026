import { useI18n } from "../i18n";

/**
 * Como o radar enxerga, num corte de lado: o satélite manda o pulso inclinado; a água lisa reflete para longe,
 * o chão irregular devolve, a copa da floresta espalha. As setas que voltam ao satélite são o que vira imagem.
 */
export function RadarDiagram() {
  const { t } = useI18n();
  return (
    <figure className="how">
      <svg viewBox="0 0 360 170" role="img" aria-label={t.sheet.howAria}>
        <defs>
          <marker id="how-out" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto"><path d="M0 0 8 4 0 8z" className="how__out-tip" /></marker>
          <marker id="how-back" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto"><path d="M0 0 8 4 0 8z" className="how__back-tip" /></marker>
        </defs>
        {/* satélite */}
        <g className="how__sat" transform="translate(30 20) rotate(28)"><rect x="-9" y="-6" width="18" height="12" /><rect x="-30" y="-3" width="18" height="6" /><rect x="12" y="-3" width="18" height="6" /></g>
        {/* superfícies: água lisa, chão irregular, floresta */}
        <path className="how__water" d="M70 138H160V150H70z" />
        <path className="how__ground" d="M160 138l8-5 7 6 9-7 8 5 7-6 9 6 8-5 4 4V150H160z" />
        <path className="how__ground" d="M230 138H345V150H230z" />
        <g className="how__tree">{[250, 276, 302, 328].map((x) => <g key={x}><path d={`M${x} 138V118`} /><circle cx={x} cy={108} r={13} /></g>)}</g>
        {/* pulsos que saem */}
        <g className="how__out">
          <path d="M40 30 112 134" markerEnd="url(#how-out)" /><path d="M44 28 190 128" markerEnd="url(#how-out)" /><path d="M48 25 282 100" markerEnd="url(#how-out)" />
        </g>
        {/* eco: a água manda para longe; o chão e a copa devolvem */}
        <path className="how__away" d="M116 134 150 86" markerEnd="url(#how-out)" />
        <path className="how__back" d="M186 122 58 34" markerEnd="url(#how-back)" />
        <path className="how__back how__back--hv" d="M278 94 62 24" markerEnd="url(#how-back)" />
        <g className="how__label"><text x="115" y="164" textAnchor="middle">{t.sheet.diagram.water}</text><text x="195" y="164" textAnchor="middle">{t.sheet.diagram.ground}</text><text x="288" y="164" textAnchor="middle">{t.sheet.diagram.forest}</text></g>
      </svg>
      <ol className="how__steps">
        <li>{t.sheet.how.pulse}</li>
        <li>{t.sheet.how.water}</li>
        <li>{t.sheet.how.rough}</li>
        <li>{t.sheet.how.canopy}</li>
      </ol>
    </figure>
  );
}
