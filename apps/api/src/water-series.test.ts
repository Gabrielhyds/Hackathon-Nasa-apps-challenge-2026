import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { scenes } from "@nexxus/contract";
import type { Lang, Scene } from "@nexxus/contract";
import { readManifest, servedScenes } from "./scene-images";

/** O arquivo que scripts/water_series.py grava: as passagens medidas, os parâmetros e as que ficaram de fora. */
interface WaterFile {
  scene: string;
  bbox: number[];
  parameters: {
    polarization: string; referenceUntil: string; dropDb: number; refMinDb: number;
    thresholdsDb: { low: number; main: number; high: number }; minPatchPx: number; smooth: number; minValidPct: number;
  };
  passes: {
    stack: string; direction: string; track: number; date: string; granule: string; validPct: number;
    reference: boolean; newWaterKm2: number; lowKm2: number; highKm2: number;
  }[];
  skipped: { stack: string; date: string; granule: string; reason: string }[];
}
const FILE = join(__dirname, "..", "..", "..", "packages", "contract", "src", "fixtures", "taquari-water.json");
const water = JSON.parse(readFileSync(FILE, "utf8")) as WaterFile;
/** Última passagem que vai à cena: ver WATER_UNTIL na fixture. */
const UNTIL = "2026-07-27";
const LANGS: Lang[] = ["en", "pt"];
const taquari = (list: Scene[]) => list.find((s) => s.id === "taquari")!;

test("a série de água foi medida no recorte e nas passagens que a cena do Taquari mostra", () => {
  const m = readManifest().scenes!.taquari;
  assert.equal(water.scene, "taquari");
  assert.deepEqual(water.bbox, m.bbox);
  assert.deepEqual(water.bbox, taquari(scenes("en")).bbox);
  const granules = water.passes.map((p) => p.granule);
  assert.ok(granules.includes(m.before.granule) && granules.includes(m.after.granule));
});

test("no arquivo, as passagens estão em ordem, cada uma na sua órbita e com a faixa em volta do valor", () => {
  const dates = water.passes.map((p) => p.date);
  assert.deepEqual(dates, [...dates].sort());
  assert.equal(new Set(water.passes.map((p) => p.granule)).size, water.passes.length);
  for (const p of water.passes) {
    const [track, dir] = p.stack.split("_");
    assert.ok(p.granule.includes(`_${p.stack}_`), `${p.date}: órbita`);
    assert.ok(p.granule.split("_")[11].startsWith(p.date.replace(/-/g, "")), `${p.date}: data`);
    assert.equal(p.track, Number(track), p.date);
    assert.equal(p.direction, dir === "A" ? "ascending" : "descending", p.date);
    assert.ok(0 <= p.lowKm2 && p.lowKm2 <= p.newWaterKm2 && p.newWaterKm2 <= p.highKm2, `${p.date}: faixa`);
    assert.equal(p.reference, p.date <= water.parameters.referenceUntil, `${p.date}: referência`);
    assert.ok(p.validPct >= water.parameters.minValidPct, `${p.date}: parte com dado`);
  }
  // pelo menos duas passagens de referência por órbita: com uma só, a medida dela contra a referência não existe
  for (const stack of new Set(water.passes.map((p) => p.stack))) {
    assert.ok(water.passes.filter((p) => p.stack === stack && p.reference).length >= 2, stack);
  }
});

test("a cena do Taquari leva a série até quatro dias depois da cheia, igual ao arquivo, nos dois idiomas", () => {
  for (const lang of LANGS) {
    const list = servedScenes(lang).scenes;
    const s = taquari(list);
    const samples = s.waterSeries!.samples;
    const published = water.passes.filter((p) => p.date <= UNTIL);
    assert.ok(published.length >= 4 && published.length < water.passes.length);
    assert.deepEqual(samples, published.map((p) => ({
      date: p.date, direction: p.direction, track: p.track, newWaterKm2: p.newWaterKm2, lowKm2: p.lowKm2, highKm2: p.highKm2,
      ...(p.reference ? { reference: true } : {}),
    })));
    // a maior medida é a da passagem da noite seguinte à cheia, a última da série de imagens da cena
    const peak = samples.reduce((a, b) => (b.newWaterKm2 > a.newWaterKm2 ? b : a));
    assert.equal(peak.date, s.acquisitions[s.acquisitions.length - 1].date);
    assert.equal(peak.reference, undefined);
    assert.ok(samples.filter((x) => x.reference).every((x) => x.newWaterKm2 < peak.newWaterKm2 / 10));
    // sem a API (modo mock do front) a série é a mesma
    assert.deepEqual(taquari(scenes(lang)).waterSeries, s.waterSeries);
    assert.deepEqual(taquari(scenes(lang)).riverGauge, s.riverGauge);
    // só o Taquari tem série e leitura de rio
    assert.ok(list.every((x) => x.id === "taquari" || !("waterSeries" in x || "riverGauge" in x)));
    // a água nova não vira `areaKm2`: o front a mostraria como "área alterada", ao lado da medida do mapa de mudança
    assert.equal(s.areaKm2, undefined);
  }
  const [en, pt] = LANGS.map((lang) => taquari(scenes(lang)).waterSeries!);
  assert.notEqual(en.method, pt.method);
  assert.deepEqual(en.samples, pt.samples);
});

test("o texto do método cita os parâmetros com que a série foi medida", () => {
  const p = water.parameters;
  // mudou um parâmetro no script? Acerte WATER_METHOD na fixture, nos dois idiomas, e esta lista
  assert.deepEqual(
    [p.polarization, p.referenceUntil, p.refMinDb, p.dropDb, p.thresholdsDb.low, p.thresholdsDb.main, p.thresholdsDb.high, p.minPatchPx, p.smooth],
    ["HH", "2026-07-21", -14, 3, -14, -12, -10, 7, 1]);
  for (const lang of LANGS) {
    const method = taquari(scenes(lang)).waterSeries!.method;
    const land = lang === "pt" ? "era terra (HH de −14 dB para cima)" : "was land (HH at −14 dB or more)";
    const range = lang === "pt" ? "faixa: −14 a −10 dB" : "range: −14 to −10 dB";
    for (const part of ["HH", land, "3 dB", "−12 dB", range, "1 ha", lang === "pt" ? "21/07/2026" : "July 21, 2026"]) {
      assert.ok(method.includes(part), `${lang}: ${part}`);
    }
  }
});

test("cada leitura do rio tem fonte, cai dentro da série e bate com o resumo", () => {
  for (const lang of LANGS) {
    const s = taquari(scenes(lang));
    const readings = s.riverGauge!;
    const samples = s.waterSeries!.samples;
    assert.ok(readings.length >= 1);
    const order = readings.map((r) => `${r.date} ${r.time ?? ""}`);
    assert.deepEqual(order, [...order].sort());
    for (const r of readings) {
      assert.ok(r.date >= samples[0].date && r.date <= samples[samples.length - 1].date, r.date);
      assert.ok(r.levelM > 0 && r.levelM < 40, r.place);
      if (r.time !== undefined) assert.match(r.time, /^\d{2}:\d{2}$/);
      if (r.floodLevelM !== undefined) assert.ok(r.floodLevelM > 0 && r.floodLevelM < r.levelM, r.place);
      assert.ok(r.source.url.startsWith("https://"), r.place);
      // o título da fonte cita o nível que a página confirma
      const level = lang === "pt" ? String(r.levelM).replace(".", ",") : String(r.levelM);
      assert.ok(r.source.title.includes(level), `${r.place}: ${level}`);
    }
    // o nível que o resumo cita é o da leitura do dia da cheia
    const flood = readings.find((r) => r.date === "2026-07-22")!;
    assert.equal(flood.levelM, 24.7);
    assert.ok(s.summary.includes(lang === "pt" ? "24,7 m" : "24.7 m"));
  }
  const [en, pt] = LANGS.map((lang) => taquari(scenes(lang)).riverGauge!);
  assert.deepEqual(en.map((r) => [r.date, r.time, r.levelM, r.trend, r.floodLevelM, r.source.url]),
    pt.map((r) => [r.date, r.time, r.levelM, r.trend, r.floodLevelM, r.source.url]));
  assert.ok(en.every((r, i) => r.place !== pt[i].place && r.source.title !== pt[i].source.title));
});
