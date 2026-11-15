/**
 * RÉGUA DE FRANJAS. Um interferograma guarda, em cada pixel, a diferença de fase entre duas passagens.
 * A fase dá uma volta completa (uma franja, um ciclo de cor) a cada meio comprimento de onda de mudança na
 * distância entre o chão e o satélite, porque a onda vai e volta: na banda L do NISAR, cerca de 12 cm por franja.
 * Aqui a fase vem num byte por pixel: 0 = sem dado, 1 a 255 = fração da volta. Ver scripts/insar_fringes.py.
 *
 * A régua CONTA franjas entre as duas pontas; não converte em centímetros de chão. A fase leva também o atraso da
 * ionosfera e do resto da atmosfera, e a conta não diz para que lado nada andou: a tela mostra a contagem e
 * quanto vale uma franja, e para aí.
 */
export interface Point { x: number; y: number }

export interface Transect {
  /** Fase desenrolada ao longo da linha, em voltas, começando em zero. */
  cycles: Float32Array;
  /** Fase enrolada, de 0 a 1 volta. */
  wrapped: Float32Array;
  /** De 0 a 1: quanto os pixels vizinhos concordam. Baixo é ruído (água, por exemplo). */
  coherence: Float32Array;
  /** Comprimento da linha, em pixels. */
  lengthPx: number;
}

/** Abaixo disto os vizinhos não concordam: a fase ali é ruído. */
export const MIN_COHERENCE = 0.35;

/**
 * Lê a fase ao longo de uma linha. Em cada passo faz a média complexa de uma janela (2·win + 1)² e soma as
 * diferenças de fase entre passos vizinhos, sempre pelo caminho mais curto (menos de meia volta por passo).
 */
export function readTransect(phase: Uint8Array | Uint8ClampedArray, width: number, height: number, from: Point, to: Point, win = 2): Transect {
  const lengthPx = Math.hypot(to.x - from.x, to.y - from.y), n = Math.max(2, Math.round(lengthPx) + 1);
  const cycles = new Float32Array(n), wrapped = new Float32Array(n), coherence = new Float32Array(n);
  let prev = 0, sum = 0;
  for (let i = 0; i < n; i++) {
    const cx = Math.round(from.x + ((to.x - from.x) * i) / (n - 1)), cy = Math.round(from.y + ((to.y - from.y) * i) / (n - 1));
    let re = 0, im = 0, count = 0;
    for (let y = cy - win; y <= cy + win; y++) {
      if (y < 0 || y >= height) continue;
      for (let x = cx - win; x <= cx + win; x++) {
        if (x < 0 || x >= width) continue;
        count++;
        const v = phase[y * width + x];
        if (!v) continue;
        const a = ((v - 1) / 255) * 2 * Math.PI;
        re += Math.cos(a); im += Math.sin(a);
      }
    }
    const turn = Math.atan2(im, re) / (2 * Math.PI);
    coherence[i] = count ? Math.hypot(re, im) / count : 0;
    wrapped[i] = (turn + 1) % 1;
    if (i > 0) { let d = turn - prev; d -= Math.round(d); sum += d; }
    cycles[i] = sum;
    prev = turn;
  }
  return { cycles, wrapped, coherence, lengthPx };
}

export interface FringeReading {
  /** Franjas entre as duas pontas da linha (diferença líquida, sem sinal). */
  fringes: number;
  /** Parte da linha em que a fase é confiável, de 0 a 1. */
  solid: number;
  /** `false` quando muito da linha cai em ruído: o número não vale. */
  reliable: boolean;
}

/** Quantas franjas a linha atravessa e se a contagem vale. */
export function fringeReading(t: Transect): FringeReading {
  const fringes = Math.abs(t.cycles[t.cycles.length - 1]);
  let ok = 0;
  for (const c of t.coherence) if (c >= MIN_COHERENCE) ok++;
  const solid = ok / t.coherence.length;
  return { fringes, solid, reliable: solid >= 0.9 };
}

/** "5cE1ff" × 256 → tabela RGBA para pintar a fase. */
export function parseLut(hex: string[]): Uint8ClampedArray {
  const out = new Uint8ClampedArray(hex.length * 4);
  hex.forEach((h, i) => {
    out[i * 4] = parseInt(h.slice(0, 2), 16); out[i * 4 + 1] = parseInt(h.slice(2, 4), 16); out[i * 4 + 2] = parseInt(h.slice(4, 6), 16); out[i * 4 + 3] = 255;
  });
  return out;
}

/** Pinta a fase com a tabela de cores. `dim` (0 a 1) escurece onde não há dado. */
export function paintPhase(phase: Uint8Array | Uint8ClampedArray, lut: Uint8ClampedArray, out: Uint8ClampedArray): void {
  const size = lut.length / 4;
  for (let i = 0; i < phase.length; i++) {
    const v = phase[i], o = i * 4;
    if (!v) { out[o] = 9; out[o + 1] = 12; out[o + 2] = 20; out[o + 3] = 255; continue; }
    const k = Math.min(size - 1, Math.floor(((v - 1) / 255) * size)) * 4;
    out[o] = lut[k]; out[o + 1] = lut[k + 1]; out[o + 2] = lut[k + 2]; out[o + 3] = 255;
  }
}
