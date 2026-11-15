import type { WaterSample } from "@nexxus/contract";
import { axisMax, chartSpan, timeFraction } from "../lib/hydro";

// Fica fora de Hydrograph.tsx de propósito: a folha da cena usa só esta miniatura, e o laboratório inteiro (com o
// gráfico grande, a simulação do pulso e a régua de franjas) é baixado à parte, só quando alguém o abre.

/** Uma versão pequena da série, para o painel da cena: só as hastes. */
export function HydroSpark({ samples }: { samples: WaterSample[] }) {
  const max = axisMax(samples), span = chartSpan(samples, undefined, 2, 2);
  return (
    <svg className="spark" viewBox="0 0 300 56" aria-hidden="true">
      <line x1="0" x2="300" y1="52" y2="52" className="spark__axis" />
      {samples.map((s) => {
        const x = 4 + timeFraction(span, s.date) * 292, y = 52 - (s.newWaterKm2 / max) * 46;
        return <g key={s.date} className={`spark__${s.direction}`}><line x1={x} x2={x} y1="52" y2={y} /><circle cx={x} cy={y} r="2.6" /></g>;
      })}
    </svg>
  );
}
