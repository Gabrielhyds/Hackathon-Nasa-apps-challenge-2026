const R = 6371; // raio médio da Terra, km
const rad = Math.PI / 180;

/** Ponto a `km` de distância de [lon, lat], seguindo o azimute `bearing` (graus a partir do norte). */
export function destination([lon, lat]: [number, number], bearing: number, km: number): [number, number] {
  const d = km / R, b = bearing * rad, p1 = lat * rad, l1 = lon * rad;
  const p2 = Math.asin(Math.sin(p1) * Math.cos(d) + Math.cos(p1) * Math.sin(d) * Math.cos(b));
  const l2 = l1 + Math.atan2(Math.sin(b) * Math.sin(d) * Math.cos(p1), Math.cos(d) - Math.sin(p1) * Math.sin(p2));
  return [((l2 / rad + 540) % 360) - 180, p2 / rad];
}

/** Distância em km entre dois pontos [lon, lat]. */
export function distanceKm(a: [number, number], b: [number, number]): number {
  const dp = (b[1] - a[1]) * rad, dl = (b[0] - a[0]) * rad;
  const h = Math.sin(dp / 2) ** 2 + Math.cos(a[1] * rad) * Math.cos(b[1] * rad) * Math.sin(dl / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/** Órbita do NISAR: inclinação de 98,4° e faixa imageada de cerca de 240 km. */
export const NISAR = { inclination: 98.4, swathKm: 240, repeatDays: 12 };

/**
 * Rumo do traço da órbita no solo, em graus a partir do norte, para uma latitude.
 * Vem de cos(i) = sin(azimute) · cos(lat). Perto dos polos o satélite não chega, e o rumo satura.
 */
export function groundTrackBearing(lat: number, direction: "ascending" | "descending"): number {
  const s = Math.max(-1, Math.min(1, Math.cos(NISAR.inclination * rad) / Math.cos(lat * rad)));
  const az = Math.asin(s) / rad;
  return direction === "ascending" ? az : 180 - az;
}

/**
 * Faixa imageada por uma órbita ao passar por `here`, como polígono, e o traço central como linha.
 * `reachKm` é quanto da faixa já foi percorrido, de 0 a 2 × `halfKm`: serve para a faixa entrar atravessando o lugar.
 */
export function swath(here: [number, number], direction: "ascending" | "descending", reachKm: number, halfKm = 1400) {
  const az = groundTrackBearing(here[1], direction);
  const reach = Math.max(0, Math.min(2 * halfKm, reachKm));
  const along = (d: number) => (d < 0 ? destination(here, az + 180, -d) : destination(here, az, d));
  const stops: number[] = [];
  for (let d = -halfKm; d < reach - halfKm; d += 100) stops.push(d);
  stops.push(reach - halfKm);
  const line = stops.map(along);
  const left = line.map((p) => destination(p, az - 90, NISAR.swathKm / 2));
  const right = line.map((p) => destination(p, az + 90, NISAR.swathKm / 2));
  return { line, ring: [...left, ...right.reverse(), left[0]] };
}

/** Área de um recorte [oeste, sul, leste, norte] sobre a esfera, em km². */
export function bboxAreaKm2([west, south, east, north]: [number, number, number, number]): number {
  return R * R * Math.abs(east - west) * rad * Math.abs(Math.sin(north * rad) - Math.sin(south * rad));
}
