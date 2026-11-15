import type { Polarization } from "@nexxus/contract";
import { changedParts } from "./change";

/**
 * MEDIDAS DO PAR DE PASSAGENS, para a aba Medir da folha da cena. Tudo sai do mapa de mudança (`lib/change.ts`):
 * para cada pixel, ln(depois / antes) da amplitude suavizada. Aqui ele vira decibéis (20 · log10 da razão), um
 * histograma e a área que escureceu e clareou em cada limiar. Não é a medida de água do Taquari (`waterSeries`),
 * que tem teste de água e referência de águas baixas: é só o quanto o sinal mudou.
 */

/** ln da razão de amplitude → decibéis. */
export const LN_TO_DB = 20 / Math.LN10;
/** Razão de amplitude (1,25×) → decibéis (1,9 dB). */
export const ratioToDb = (ratio: number) => 20 * Math.log10(ratio);
export const dbToRatio = (db: number) => 10 ** (Math.abs(db) / 20);

/**
 * Abaixo disto a área de um lado aparece como "0 km²" depois de arredondada, o que parece defeito: a tela escreve
 * "quase nada" no lugar. Vale para um lado só; quando os dois somam pouco, a tela já troca tudo por uma frase.
 */
export const NEGLIGIBLE_KM2 = 0.05;
export const negligibleArea = (km2: number): boolean => !(km2 >= NEGLIGIBLE_KM2);

export interface Histogram {
  /** Quantos pixels caem em cada faixa, da maior queda (−`rangeDb`) à maior subida (+`rangeDb`). */
  counts: number[];
  /** Metade da largura do eixo, em dB. O que passa disso entra na primeira ou na última faixa. */
  rangeDb: number;
}

/** Histograma da mudança, em dB: quantos pixels caíram ou subiram quanto. */
export function changeHistogram(change: Float32Array, bins = 48, rangeDb = 12): Histogram {
  const counts = new Array<number>(bins).fill(0);
  for (let i = 0; i < change.length; i++) {
    const db = change[i] * LN_TO_DB;
    counts[Math.max(0, Math.min(bins - 1, Math.floor(((db + rangeDb) / (2 * rangeDb)) * bins)))]++;
  }
  return { counts, rangeDb };
}

export interface ThresholdRow { ratio: number; db: number; fellKm2: number; roseKm2: number }

/** Limiares da tabela: os dois extremos do controle de sensibilidade e dois pontos no meio. */
export const TABLE_RATIOS = [1.1, 1.25, 1.5, 2];

/** Área que escureceu e que clareou em cada limiar: mostra o quanto o número depende da sensibilidade escolhida. */
export function thresholdTable(change: Float32Array, areaKm2: number, ratios: readonly number[] = TABLE_RATIOS): ThresholdRow[] {
  return ratios.map((ratio) => {
    const parts = changedParts(change, ratio);
    return { ratio, db: Math.round(ratioToDb(ratio) * 10) / 10, fellKm2: parts.down * areaKm2, roseKm2: parts.up * areaKm2 };
  });
}

/** O que o mapa conta para a folha sobre o par em tela. */
export interface MapAnalysis {
  sceneId: string;
  pol: Polarization;
  /** Datas das duas passagens comparadas. */
  from: string;
  to: string;
  /** Limiar em uso: a partir de quantas vezes de diferença de amplitude um pixel conta. */
  ratio: number;
  fellKm2: number;
  roseKm2: number;
  histogram: Histogram;
  table: ThresholdRow[];
  /** Dado calibrado (mesma escala nas duas datas): a mediana da cena não foi descontada. */
  calibrated: boolean;
  /** Imagem de exemplo, gerada na página: as medidas servem para ver a tela, não dizem nada do lugar. */
  example: boolean;
}
