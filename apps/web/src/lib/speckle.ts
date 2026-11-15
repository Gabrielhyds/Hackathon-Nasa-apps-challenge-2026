import type { Polarization } from "@nexxus/contract";
import { growth } from "./series";

/** Amostras de ruído por pixel. Uma só daria o granulado do radar bruto, forte demais para o limiar do mapa de mudança. */
const LOOKS = 6;

/** Gerador determinístico: a mesma semente dá sempre a mesma imagem. */
function rng(seed: number) {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const hash = (s: string) => [...s].reduce((h, c) => (Math.imul(h, 31) + c.charCodeAt(0)) | 0, 7);

export interface Outline { cx: number; cy: number; rx: number; ry: number }

export interface SyntheticSeries {
  /** Uma imagem por passagem, da mais antiga para a mais recente. */
  frames: HTMLCanvasElement[];
  /** Elipse da área alterada em cada passagem, em fração do lado da imagem. `null` na primeira, antes da mudança. */
  outlines: (Outline | null)[];
}

/**
 * IMAGEM DE EXEMPLO. Desenha uma série de passagens de radar com ruído speckle e uma mancha que cresce a cada passagem.
 * Só é usada quando a cena não traz imagem. Não é dado do NISAR.
 * As duas polarizações partem do mesmo terreno: HV volta mais fraca e reage mais a vegetação
 * (a mancha escura muda mais); HH volta mais forte e reage mais a paredes e solo (a mancha clara muda mais).
 */
export function syntheticSeries(id: string, change: "darker" | "brighter", polarization: Polarization, count: number, size = 160): SyntheticSeries {
  const r = rng(hash(id));
  const grid = Array.from({ length: 64 }, () => r());
  const full: Outline = { cx: 0.35 + r() * 0.3, cy: 0.35 + r() * 0.3, rx: 0.12 + r() * 0.2, ry: 0.1 + r() * 0.14 };
  // ruído próprio de cada polarização, para as duas não parecerem a mesma imagem
  const noise = rng(hash(id + polarization));
  const hv = polarization === "HV";
  const level = hv ? 0.55 : 1;
  const factor = change === "darker" ? (hv ? 0.12 : 0.3) : (hv ? 2.4 : 3.4);
  const smooth = (x: number, y: number) => {
    const gx = x * 7, gy = y * 7, i = Math.floor(gx), j = Math.floor(gy), fx = gx - i, fy = gy - j;
    const q = (a: number, b: number) => grid[(a % 8) + (b % 8) * 8];
    return q(i, j) * (1 - fx) * (1 - fy) + q(i + 1, j) * fx * (1 - fy) + q(i, j + 1) * (1 - fx) * fy + q(i + 1, j + 1) * fx * fy;
  };
  const outlines = Array.from({ length: count }, (_, k) => {
    const g = growth(k, count);
    return g === 0 ? null : { ...full, rx: full.rx * g, ry: full.ry * g };
  });
  const frames = outlines.map((outline) => {
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = size;
    const ctx = canvas.getContext("2d")!;
    const img = ctx.createImageData(size, size);
    for (let j = 0; j < size; j++) {
      for (let i = 0; i < size; i++) {
        const u = i / size, v = j / size;
        let val = (0.25 + 0.55 * smooth(u, v)) * level;
        if (outline) {
          const inside = ((u - outline.cx) / outline.rx) ** 2 + ((v - outline.cy) / outline.ry) ** 2 + (smooth(v, u) - 0.5) * 0.8 < 1;
          if (inside) val *= factor;
        }
        // speckle multiplicativo, média de LOOKS amostras: granulado parecido com o do preview real, que já vem suavizado
        let speckle = 0;
        for (let l = 0; l < LOOKS; l++) speckle -= Math.log(1 - noise() * 0.98);
        val *= (speckle / LOOKS) * 0.9;
        const p = (j * size + i) * 4, c = Math.min(255, val * 255);
        img.data[p] = img.data[p + 1] = img.data[p + 2] = c;
        img.data[p + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
    return canvas;
  });
  return { frames, outlines };
}
