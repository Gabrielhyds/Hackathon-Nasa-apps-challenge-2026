/**
 * LEITURA EM dB SOB O PONTEIRO. As imagens calibradas (scripts/gcov_crop.py) gravam a AMPLITUDE de gamma0 numa
 * escala fixa: cinza = 255 · amplitude / topo, com o topo em `topDb` (0 dB em HH, −6 dB em HV). Então cada cinza
 * volta a ser um valor em dB: dB = topDb + 20 · log10(cinza / 255). Só vale para o dado calibrado; o preview tem o
 * contraste esticado em cada data e o cinza dele não é uma medida.
 *
 * Limites da leitura, que a tela diz: cinza 255 é "topo ou mais" (o pixel saturou), e cinza 0 é "sem dado ou abaixo
 * do piso" (a imagem de 8 bits não separa os dois). O piso é o valor do meio cinza: cerca de 54 dB abaixo do topo.
 */

export type Reading =
  | { kind: "value"; db: number }
  /** Cinza 255: o sinal é o topo da escala ou mais. */
  | { kind: "top"; db: number }
  /** Cinza 0: sem dado nessa data, ou sinal abaixo do piso da imagem de 8 bits. */
  | { kind: "floor"; db: number };

/** O menor valor que um cinza diferente de zero representa: meio cinza abaixo do topo. */
export const floorDb = (topDb: number) => topDb + 20 * Math.log10(0.5 / 255);

/** Cinza de 0 a 255 → leitura em dB de gamma0, com uma casa. */
export function grayToDb(gray: number, topDb: number): Reading {
  const g = Math.max(0, Math.min(255, Math.round(gray)));
  if (g === 0) return { kind: "floor", db: Math.round(floorDb(topDb)) };
  if (g === 255) return { kind: "top", db: topDb };
  return { kind: "value", db: Math.round((topDb + 20 * Math.log10(g / 255)) * 10) / 10 };
}

const mercatorY = (lat: number) => Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360));

/**
 * O pixel da imagem (lado `size`) que o mapa desenha sob um ponto. O mapa estica a imagem entre os cantos do `bbox`
 * ([oeste, sul, leste, norte]) em linha reta na projeção de Mercator, então a linha sai da latitude projetada: é o
 * pixel que a pessoa está vendo. `null` fora do recorte.
 */
export function pixelUnder(bbox: readonly [number, number, number, number], lon: number, lat: number, size: number): { x: number; y: number } | null {
  const [west, south, east, north] = bbox;
  const fx = (lon - west) / (east - west), fy = (mercatorY(north) - mercatorY(lat)) / (mercatorY(north) - mercatorY(south));
  if (!(fx >= 0 && fx <= 1 && fy >= 0 && fy <= 1)) return null;
  return { x: Math.min(size - 1, Math.floor(fx * size)), y: Math.min(size - 1, Math.floor(fy * size)) };
}

/** Média dos cinzas numa janela (2·radius + 1)² em volta do pixel: o granulado do radar faz um pixel só pular muito. */
export function meanGray(gray: Uint8Array | Uint8ClampedArray, size: number, x: number, y: number, radius = 1): number {
  let sum = 0, n = 0;
  for (let j = Math.max(0, y - radius); j <= Math.min(size - 1, y + radius); j++)
    for (let i = Math.max(0, x - radius); i <= Math.min(size - 1, x + radius); i++) { sum += gray[j * size + i]; n++; }
  return n ? sum / n : 0;
}
