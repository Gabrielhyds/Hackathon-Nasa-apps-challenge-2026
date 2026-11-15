import { describe, expect, it } from "vitest";
import { TABLE_RATIOS, changeHistogram, dbToRatio, ratioToDb, thresholdTable } from "./analysis";
import { DEFAULT_SENSITIVITY, ratioFor, sensitivityFor } from "./change";

// metade dos pixels não muda, um quarto cai 5 dB e um quarto sobe 3 dB
const change = Float32Array.from({ length: 400 }, (_, i) => (i < 200 ? 0 : i < 300 ? Math.log(10 ** (-5 / 20)) : Math.log(10 ** (3 / 20))));

describe("medidas do par de passagens", () => {
  it("converte razão de amplitude em decibéis e de volta", () => {
    expect(ratioToDb(2)).toBeCloseTo(6.02, 2);
    expect(ratioToDb(1.25)).toBeCloseTo(1.94, 2);
    expect(dbToRatio(-6.02)).toBeCloseTo(2, 2);
  });
  it("o histograma conta todos os pixels e põe queda à esquerda e subida à direita", () => {
    const h = changeHistogram(change, 48, 12);
    expect(h.counts.reduce((a, b) => a + b, 0)).toBe(400);
    expect(h.counts[24]).toBe(200);                       // 0 dB
    expect(h.counts.slice(0, 24).reduce((x, y) => x + y, 0)).toBe(100);   // a queda de 5 dB, à esquerda do zero
    expect(h.counts.slice(12, 16).reduce((x, y) => x + y, 0)).toBe(100);  // entre −6 e −4 dB
    expect(h.counts.slice(25).reduce((a, b) => a + b, 0)).toBe(100);
    // o que passa da ponta do eixo não some: entra na última faixa
    expect(changeHistogram(Float32Array.from([-9, 9]), 10, 12).counts).toEqual([1, 0, 0, 0, 0, 0, 0, 0, 0, 1]);
  });
  it("a tabela mostra a área de cada lado em cada limiar, e limiar mais exigente nunca aumenta a área", () => {
    const rows = thresholdTable(change, 1000);
    expect(rows.map((r) => r.ratio)).toEqual(TABLE_RATIOS);
    expect(rows[0]).toMatchObject({ fellKm2: 250, roseKm2: 250 });      // 1,1×: os dois lados contam
    expect(rows[2]).toMatchObject({ fellKm2: 250, roseKm2: 0 });        // 1,5× (3,5 dB): a subida de 3 dB sai
    expect(rows[3]).toMatchObject({ fellKm2: 0, roseKm2: 0 });          // 2× (6 dB): a queda de 5 dB também sai
    rows.forEach((r, i) => { if (i) { expect(r.fellKm2).toBeLessThanOrEqual(rows[i - 1].fellKm2); expect(r.roseKm2).toBeLessThanOrEqual(rows[i - 1].roseKm2); } });
  });
  it("a sensibilidade volta do limiar: é o inverso de ratioFor, presa às pontas do controle", () => {
    expect(sensitivityFor(1.25)).toBeCloseTo(DEFAULT_SENSITIVITY, 6);
    for (const s of [0, 0.3, 0.8, 1]) expect(sensitivityFor(ratioFor(s))).toBeCloseTo(s, 6);
    expect(sensitivityFor(5)).toBe(0);
    expect(sensitivityFor(1)).toBe(1);
  });
});
