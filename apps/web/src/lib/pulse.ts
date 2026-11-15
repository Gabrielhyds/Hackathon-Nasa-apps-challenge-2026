/**
 * COMPRESSÃO DE PULSO. O radar manda um pulso longo cuja frequência varre uma banda (chirp). O eco volta fraco,
 * espalhado pela duração do pulso e enterrado no ruído. Correlacionar o eco com o pulso enviado junta essa
 * energia num pico estreito: a largura cai de c·T/2 para c/(2·B) e o sinal sobe B·T vezes acima do ruído.
 * A correlação é feita no domínio da frequência: FFT do eco, vezes o conjugado da FFT do pulso, FFT inversa.
 * Tudo aqui é simulação em banda base, com números complexos em pares de vetores (parte real, parte imaginária).
 */
const C = 299_792_458; // m/s
const OVERSAMPLE = 2;  // amostras por 1/B

/** FFT de base 2, no lugar. `inverse` devolve a transformada inversa já dividida por N. */
export function fft(re: Float64Array, im: Float64Array, inverse = false): void {
  const n = re.length;
  if (n & (n - 1)) throw new Error("o tamanho da FFT precisa ser potência de 2");
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) { const a = re[i]; re[i] = re[j]; re[j] = a; const b = im[i]; im[i] = im[j]; im[j] = b; }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = ((inverse ? 2 : -2) * Math.PI) / len, wr = Math.cos(ang), wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const a = i + k, b = a + len / 2;
        const xr = re[b] * cr - im[b] * ci, xi = re[b] * ci + im[b] * cr;
        re[b] = re[a] - xr; im[b] = im[a] - xi; re[a] += xr; im[a] += xi;
        const t = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = t;
      }
    }
  }
  if (inverse) for (let i = 0; i < n; i++) { re[i] /= n; im[i] /= n; }
}

/** Gerador de números aleatórios com semente, para o mesmo ruído voltar enquanto os controles mexem. */
export function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface PulseParams {
  bandwidthMHz: number;
  durationUs: number;
  /** Potência do eco sobre a do ruído antes da compressão, em dB. */
  snrDb: number;
  /** Distância entre os dois alvos, em metros. Zero: um alvo só. */
  separationM: number;
  seed: number;
}

/** Os números que não dependem do ruído. */
export function pulseFigures({ bandwidthMHz, durationUs }: Pick<PulseParams, "bandwidthMHz" | "durationUs">) {
  const b = bandwidthMHz * 1e6, t = durationUs * 1e-6, gain = b * t;
  return {
    /** Produto banda × duração: quantas vezes o sinal sobe acima do ruído. */
    gain,
    gainDb: 10 * Math.log10(gain),
    /** Comprimento do pulso no espaço, ida e volta: o que seria a resolução sem compressão. */
    pulseLengthM: (C * t) / 2,
    /** Resolução depois da compressão. */
    resolutionM: C / (2 * b),
    /** Amostras do pulso na simulação. */
    samples: Math.round(t * b * OVERSAMPLE),
  };
}

export interface PulseSim {
  n: number;
  /** Metros de distância por amostra. */
  metersPerSample: number;
  /** Amostras ocupadas pelo pulso. */
  pulseSamples: number;
  /** Posição (amostra) do começo do eco de cada alvo. */
  targets: number[];
  /** Parte real do pulso enviado, só as amostras do pulso. */
  chirp: Float64Array;
  /** Parte real do que o radar recebe: os ecos mais o ruído. */
  echo: Float64Array;
  /** Parte real dos ecos sem o ruído, para mostrar onde eles estão escondidos. */
  clean: Float64Array;
  /** Potência depois da correlação, com o pico de um alvo isolado valendo 1 quando não há ruído. */
  compressed: Float64Array;
  /** Espectro de potência do pulso e do que foi recebido, com a frequência zero no meio, de −B a +B. */
  spectrumPulse: Float64Array;
  spectrumEcho: Float64Array;
  /** Multiplicações para correlacionar direto no tempo e pela FFT. */
  costDirect: number;
  costFft: number;
}

/** Simula o envio, a volta com ruído e a compressão. */
export function simulatePulse(p: PulseParams): PulseSim {
  const fig = pulseFigures(p), ns = fig.samples;
  const fs = p.bandwidthMHz * 1e6 * OVERSAMPLE, metersPerSample = C / (2 * fs);
  const gap = Math.round(p.separationM / metersPerSample);
  let n = 1024;
  while (n < 3 * ns + gap + 256) n <<= 1;
  const rand = seeded(p.seed);
  // pulso: frequência varrendo de −B/2 a +B/2 ao longo da duração
  const sr = new Float64Array(n), si = new Float64Array(n);
  const rate = (p.bandwidthMHz * 1e6) / (p.durationUs * 1e-6);
  for (let k = 0; k < ns; k++) {
    const t = (k - ns / 2) / fs, ph = Math.PI * rate * t * t;
    sr[k] = Math.cos(ph); si[k] = Math.sin(ph);
  }
  // ruído branco limitado à banda do radar, com potência 1 por amostra
  const nr = new Float64Array(n), ni = new Float64Array(n);
  for (let k = 0; k < n; k++) {
    const u = Math.sqrt(-Math.log(1 - rand())), v = 2 * Math.PI * rand();
    nr[k] = u * Math.cos(v); ni[k] = u * Math.sin(v);
  }
  fft(nr, ni);
  const edge = Math.round(n / (2 * OVERSAMPLE));
  for (let k = edge + 1; k < n - edge; k++) { nr[k] = 0; ni[k] = 0; }
  fft(nr, ni, true);
  const fix = Math.sqrt(n / (2 * edge + 1));
  // ecos: cópias atrasadas do pulso, com a amplitude que dá a relação sinal-ruído pedida
  const amp = 10 ** (p.snrDb / 20), first = Math.round((n - ns - gap) / 2);
  const targets = gap > 0 ? [first, first + gap] : [first];
  const rr = new Float64Array(n), ri = new Float64Array(n), clean = new Float64Array(n);
  targets.forEach((at, j) => {
    const turn = j * 2.1; // fase diferente em cada alvo, como no chão de verdade
    const cr = Math.cos(turn) * amp, ci = Math.sin(turn) * amp;
    for (let k = 0; k < ns; k++) { rr[at + k] += sr[k] * cr - si[k] * ci; ri[at + k] += sr[k] * ci + si[k] * cr; }
  });
  for (let k = 0; k < n; k++) { clean[k] = rr[k]; rr[k] += nr[k] * fix; ri[k] += ni[k] * fix; }
  const echo = Float64Array.from(rr);
  // correlação pela frequência: FFT(eco) × conj(FFT(pulso)) e volta
  const Sr = Float64Array.from(sr), Si = Float64Array.from(si);
  fft(Sr, Si); fft(rr, ri);
  const spectrumPulse = new Float64Array(n), spectrumEcho = new Float64Array(n);
  for (let k = 0; k < n; k++) {
    const at = (k + n / 2) % n; // frequência zero no meio
    spectrumPulse[at] = Sr[k] * Sr[k] + Si[k] * Si[k];
    spectrumEcho[at] = rr[k] * rr[k] + ri[k] * ri[k];
    const yr = rr[k] * Sr[k] + ri[k] * Si[k], yi = ri[k] * Sr[k] - rr[k] * Si[k];
    rr[k] = yr; ri[k] = yi;
  }
  fft(rr, ri, true);
  const compressed = new Float64Array(n), peak = (amp * ns) ** 2;
  for (let k = 0; k < n; k++) compressed[k] = (rr[k] * rr[k] + ri[k] * ri[k]) / peak;
  return {
    n, metersPerSample, pulseSamples: ns, targets, chirp: sr.slice(0, ns), echo, clean, compressed, spectrumPulse, spectrumEcho,
    costDirect: n * ns, costFft: Math.round(3 * n * Math.log2(n)),
  };
}

/** Relação sinal-ruído medida na saída: o maior pico sobre a média do que fica longe dos alvos, em dB. */
export function measuredOutputSnrDb(sim: PulseSim): number {
  let peak = 0, noise = 0, count = 0;
  const guard = Math.max(8, Math.round(sim.pulseSamples / 8));
  for (let k = 0; k < sim.n; k++) {
    peak = Math.max(peak, sim.compressed[k]);
    if (sim.targets.every((at) => Math.abs(k - at) > guard + (sim.targets.length > 1 ? Math.abs(sim.targets[1] - sim.targets[0]) : 0))) { noise += sim.compressed[k]; count++; }
  }
  return 10 * Math.log10(peak / (noise / Math.max(1, count)));
}
