/**
 * O céu atrás do globo: onde cada estrela cai na tela e o plano da Via Láctea.
 *
 * O globo é visto de fora, por uma câmera que olha para o centro da Terra por cima do ponto central do mapa.
 * O que aparece em volta dele é o céu que está de fato atrás da Terra para quem olha daquele lado, na hora
 * em que a página está aberta: a longitude do mapa vira ascensão reta pelo tempo sideral de Greenwich.
 * Tudo aqui trabalha no sistema equatorial (x para o ponto vernal, z para o polo norte celeste).
 *
 * Limites: sem precessão nem nutação (erro de frações de grau, invisível nesta escala).
 */
export type Vec3 = [number, number, number];

const RAD = Math.PI / 180;
const mod360 = (d: number) => ((d % 360) + 360) % 360;

/** Abertura vertical da câmera do MapLibre, em radianos (36,87°). */
export const FOV = 0.6435011087932844;

/** Dias desde J2000.0 (meio-dia de 1º de janeiro de 2000, UTC). */
export const daysSinceJ2000 = (date: Date) => date.getTime() / 86400000 + 2440587.5 - 2451545;

/** Tempo sideral médio de Greenwich, em graus: a ascensão reta que está sobre o meridiano de Greenwich. */
export const gmstDeg = (date: Date) => mod360(280.46061837 + 360.98564736629 * daysSinceJ2000(date));

/** Vetor unitário de uma direção dada em longitude (ou ascensão reta) e latitude (ou declinação), em graus. */
export function unit(lonDeg: number, latDeg: number): Vec3 {
  const lon = lonDeg * RAD, lat = latDeg * RAD, c = Math.cos(lat);
  return [c * Math.cos(lon), c * Math.sin(lon), Math.sin(lat)];
}

/** Coordenadas galácticas para equatoriais (J2000), em graus: [ascensão reta, declinação]. */
export function galacticToEquatorial(lDeg: number, bDeg: number): [number, number] {
  const POLE_RA = 192.85948, POLE_DEC = 27.12825 * RAD, L_NCP = 122.93192;
  const b = bDeg * RAD, dl = (L_NCP - lDeg) * RAD;
  const sinDec = Math.sin(b) * Math.sin(POLE_DEC) + Math.cos(b) * Math.cos(POLE_DEC) * Math.cos(dl);
  const ra = POLE_RA + Math.atan2(Math.cos(b) * Math.sin(dl), Math.sin(b) * Math.cos(POLE_DEC) - Math.cos(b) * Math.sin(POLE_DEC) * Math.cos(dl)) / RAD;
  return [mod360(ra), Math.asin(Math.max(-1, Math.min(1, sinDec))) / RAD];
}

/** Eixos da câmera que olha para o centro da Terra por cima de um ponto: leste (direita da tela), norte (cima) e para fora (na direção da câmera). */
export interface Basis { east: Vec3; north: Vec3; out: Vec3 }
export function cameraBasis(latDeg: number, lonDeg: number): Basis {
  const lon = lonDeg * RAD, lat = latDeg * RAD;
  return {
    east: [-Math.sin(lon), Math.cos(lon), 0],
    north: [-Math.sin(lat) * Math.cos(lon), -Math.sin(lat) * Math.sin(lon), Math.cos(lat)],
    out: unit(lonDeg, latDeg),
  };
}
const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

/** O globo na tela: raio em pixels, distância da câmera ao ponto central e o raio do contorno visto em perspectiva. */
export interface GlobeView { radius: number; distance: number; limb: number }
export function globeView(zoom: number, latDeg: number, height: number): GlobeView {
  // o MapLibre aumenta o globo longe do equador para a escala no centro igualar a do mapa plano
  const radius = (512 * 2 ** zoom) / (2 * Math.PI) / Math.cos(latDeg * RAD), distance = (0.5 * height) / Math.tan(FOV / 2);
  const far = distance + radius;
  return { radius, distance, limb: (distance * radius) / Math.sqrt(far * far - radius * radius) };
}

/**
 * Onde uma direção do céu cai na tela, em pixels a partir do centro do globo (x para a direita, y para baixo).
 * `null`: a direção está atrás da câmera.
 */
export function projectSky(dir: Vec3, basis: Basis, distance: number): [number, number] | null {
  const depth = -dot(dir, basis.out);
  if (depth <= 0.05) return null;
  return [(distance * dot(dir, basis.east)) / depth, (-distance * dot(dir, basis.north)) / depth];
}

/** Cor de uma estrela pelo índice B−V: azulada, branca, amarelada, alaranjada. */
export function starColor(bv: number): [number, number, number] {
  const stops: [number, number, number, number][] = [[-0.3, 162, 190, 255], [0, 202, 216, 255], [0.4, 248, 247, 255], [0.8, 255, 240, 214], [1.4, 255, 205, 150], [2, 255, 170, 110]];
  const v = Math.max(stops[0][0], Math.min(stops[stops.length - 1][0], bv));
  for (let i = 1; i < stops.length; i++) {
    const a = stops[i - 1], b = stops[i];
    if (v <= b[0]) { const k = (v - a[0]) / (b[0] - a[0]); return [Math.round(a[1] + (b[1] - a[1]) * k), Math.round(a[2] + (b[2] - a[2]) * k), Math.round(a[3] + (b[3] - a[3]) * k)]; }
  }
  return [255, 170, 110];
}
