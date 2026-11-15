/**
 * MAPA DE MUDANÇA entre duas passagens de radar.
 * Radar tem ruído granulado (speckle), então comparar pixel a pixel acusa mudança em todo lugar.
 * Por isso cada imagem é suavizada antes, e a comparação é a razão entre as duas em escala logarítmica:
 * dobrar ou cair pela metade pesam igual, que é como o sinal de radar se comporta.
 *
 * O resultado guarda o sentido: negativo onde o sinal caiu (ficou mais escuro), positivo onde subiu. Queda e subida
 * são coisas diferentes no chão (água nova escurece; solo molhado ou vegetação crescendo clareia), então a tela
 * pinta e mede as duas em separado.
 *
 * DUAS ORIGENS DE IMAGEM, DUAS CONTAS:
 * - Preview do NISAR e imagem de exemplo: o contraste é esticado em cada data, então uma imagem inteira pode vir
 *   mais clara que a outra sem nada ter mudado no chão. Antes de comparar, a razão é dividida pela sua mediana: o
 *   que é comum à imagem toda sai, e fica o que mudou num lugar. Funciona enquanto menos da metade da imagem mudar.
 *   (Igualar o histograma inteiro foi testado e apaga mudança grande de verdade, como uma enchente.)
 * - Dado calibrado (GCOV, `calibrated`): as duas datas estão na mesma escala fixa, então a razão entre dois cinzas
 *   já é razão de amplitude de verdade e a mediana NÃO é descontada. Descontá-la enganava quando a cena inteira
 *   mudava junto: em Chókwè o chão em volta do rio clareia, a mediana sobe e a terra que ficou igual passava a
 *   contar como queda.
 */

/** Piso de brilho somado antes da razão: em área quase preta (água parada), ruído pequeno viraria razão enorme. */
const EPS = 0.04;

/** Média móvel quadrada de lado 2·radius+1, com as bordas repetidas. */
export function boxBlur(src: Float32Array, size: number, radius: number): Float32Array {
  if (radius <= 0) return src.slice();
  const pass = (input: Float32Array, horizontal: boolean) => {
    const out = new Float32Array(input.length);
    for (let a = 0; a < size; a++) {
      for (let b = 0; b < size; b++) {
        let sum = 0;
        for (let k = -radius; k <= radius; k++) {
          const c = Math.max(0, Math.min(size - 1, b + k));
          sum += horizontal ? input[a * size + c] : input[c * size + a];
        }
        out[horizontal ? a * size + b : b * size + a] = sum / (2 * radius + 1);
      }
    }
    return out;
  };
  return pass(pass(src, true), false);
}

/**
 * Para cada pixel, quanto e para que lado o sinal mudou: ln(depois / antes) das imagens suavizadas.
 * 0 = igual; ±0,69 = dobrou ou caiu pela metade; ±1,1 = triplicou ou caiu para um terço. Negativo: caiu.
 * `calibrated`: as duas imagens estão na mesma escala fixa, e a mediana não é descontada (ver o cabeçalho).
 */
export function changeMap(before: Float32Array, after: Float32Array, size: number, radius = 2, calibrated = false): Float32Array {
  const a = boxBlur(before, size, radius), b = boxBlur(after, size, radius);
  const log = new Float32Array(a.length);
  for (let i = 0; i < log.length; i++) log[i] = Math.log((b[i] + EPS) / (a[i] + EPS));
  const gain = calibrated ? 0 : median(log);
  return log.map((v) => v - gain);
}

/** Mediana de uma lista de números. */
export function median(values: Float32Array): number {
  if (!values.length) return 0;
  const sorted = Float32Array.from(values).sort(), mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/** Limites do controle de sensibilidade: de 2× (só mudança forte) a 1,1× (mudança sutil também). */
const STRONG = Math.log(2), SUBTLE = Math.log(1.1);

/** Sensibilidade de 0 a 1 → a partir de quantas vezes de diferença no sinal um pixel conta como mudança. */
export function ratioFor(sensitivity: number): number {
  const s = Math.max(0, Math.min(1, sensitivity));
  return Math.exp(STRONG - (STRONG - SUBTLE) * s);
}

/** O inverso de `ratioFor`: limiar (em vezes de amplitude) → sensibilidade de 0 a 1, presa às pontas do controle. */
export function sensitivityFor(ratio: number): number {
  return Math.max(0, Math.min(1, (STRONG - Math.log(Math.max(1, ratio))) / (STRONG - SUBTLE)));
}

/** Sensibilidade que abre a tela: 1,25×, medido nos previews reais (a mudança neles é sutil). */
export const DEFAULT_SENSITIVITY = (STRONG - Math.log(1.25)) / (STRONG - SUBTLE);

/** Abaixo desta fração da imagem, a tela diz que quase nada mudou em vez de mostrar uma área perto de zero. */
export const ALMOST_NOTHING = 0.005;

/** Frações dos pixels em que o sinal caiu (`down`) e subiu (`up`) além do limiar. */
export function changedParts(change: Float32Array, ratio: number): { down: number; up: number } {
  const limit = Math.log(ratio);
  let down = 0, up = 0;
  for (let i = 0; i < change.length; i++) { if (change[i] < -limit) down++; else if (change[i] > limit) up++; }
  return change.length ? { down: down / change.length, up: up / change.length } : { down: 0, up: 0 };
}

/** Fração dos pixels cuja mudança passa do limiar, para qualquer lado. */
export function changedFraction(change: Float32Array, ratio: number): number {
  const { down, up } = changedParts(change, ratio);
  return down + up;
}
