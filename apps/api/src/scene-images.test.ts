import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { criteria, scenes } from "@nexxus/contract";
import type { Lang, Scene } from "@nexxus/contract";
import { SCENE_IMAGES_DIR, earlierImageFiles, imageVersion, parseInclude, readManifest, sceneImageFiles, servedScenes, usableEarlier, withSceneImages } from "./scene-images";
import type { SceneImageEntry, SceneImageManifest } from "./scene-images";

const sindh = scenes("en").find((s) => s.id === "sindh")!;
const manifest: SceneImageManifest = {
  scenes: {
    sindh: {
      center: [sindh.lat, sindh.lon], bbox: [68.15, 25.65, 68.85, 26.35], stack: "041_A_015",
      polarization: "HH + HV", polarizations: ["HH", "HV"],
      before: { date: "2026-06-17", granule: "a" }, after: { date: "2026-09-09", granule: "b" },
    },
  },
};

test("cena com imagem real ganha as duas passagens, uma imagem por polarização, e o bbox do manifest", () => {
  const out = withSceneImages([sindh], manifest, "/api/scene-images", () => true)[0];
  const v = `?v=${imageVersion(manifest.scenes!.sindh)}`;
  assert.deepEqual(out.polarizations, ["HH", "HV"]);
  assert.deepEqual(out.acquisitions, [
    { date: "2026-06-17", images: { HH: `/api/scene-images/sindh/before-HH.png${v}`, HV: `/api/scene-images/sindh/before-HV.png${v}` }, granule: "a" },
    { date: "2026-09-09", images: { HH: `/api/scene-images/sindh/after-HH.png${v}`, HV: `/api/scene-images/sindh/after-HV.png${v}` }, granule: "b" },
  ]);
  assert.deepEqual(out.bbox, [68.15, 25.65, 68.85, 26.35]);
  assert.equal(out.imagery, "preview");
  // entrada de preview, sem versão, escala nem parte válida: nenhum desses campos aparece, nem como undefined
  assert.equal("imageryDetails" in out, false);
  assert.equal("release" in out.acquisitions[0], false);
});

test("a versão de cada passagem, a escala e a parte válida do manifest chegam à cena", () => {
  const entry: SceneImageEntry = {
    ...manifest.scenes!.sindh, product: "gcov", validPct: 99.8,
    scale: { quantity: "gamma0 amplitude", topDb: { HH: 0, HV: -6 } },
    before: { date: "2026-06-17", granule: "a", release: "provisional" },
    after: { date: "2026-09-09", granule: "b", release: "validated" },
  };
  const out = withSceneImages([sindh], { scenes: { sindh: entry } }, "/x", () => true)[0];
  assert.deepEqual(out.acquisitions.map((a) => [a.granule, a.release]), [["a", "provisional"], ["b", "validated"]]);
  assert.deepEqual(out.imageryDetails, { topDb: { HH: 0, HV: -6 }, validPct: 99.8 });
});

test("valor malformado no manifest não vira campo", () => {
  const base = manifest.scenes!.sindh;
  const served = (entry: SceneImageEntry) => withSceneImages([sindh], { scenes: { sindh: entry } }, "/x", () => true)[0];
  // versão desconhecida, parte válida fora de 0 a 100 e escala sem número para uma das polarizações
  const odd = served({
    ...base, product: "gcov", validPct: 140, scale: { quantity: "gamma0 amplitude", topDb: { HH: 0 } },
    before: { ...base.before, release: "final" }, after: { ...base.after, release: "" },
  });
  assert.equal("imageryDetails" in odd, false);
  assert.deepEqual(odd.acquisitions.map((a) => "release" in a), [false, false]);
  // a escala só vale para o dado calibrado, e só se for de amplitude de gamma0
  const preview = served({ ...base, validPct: 100, scale: { quantity: "gamma0 amplitude", topDb: { HH: 0, HV: -6 } } });
  assert.deepEqual(preview.imageryDetails, { validPct: 100 });
  const other = served({ ...base, product: "gcov", scale: { quantity: "sigma0 power", topDb: { HH: 0, HV: -6 } } });
  assert.equal("imageryDetails" in other, false);
});

test("cena gerada do arquivo GCOV sai marcada como calibrada, e o Taquari real é uma delas", () => {
  const gcov = { scenes: { sindh: { ...manifest.scenes!.sindh, product: "gcov" as const } } };
  assert.equal(withSceneImages([sindh], gcov, "/x", () => true)[0].imagery, "gcov");
  assert.equal(readManifest().scenes?.taquari?.product, "gcov");
});

test("as cenas de exemplo batem com o manifest real e os arquivos existem", () => {
  const real = readManifest();
  for (const s of scenes("en", ["interferogram"])) {
    const m = real.scenes?.[s.id];
    if (!m) continue; // cena sem imagem real fica com o exemplo
    // imagem de fase só em cena de interferograma, com a primeira passagem de cada par igual à do manifest
    assert.equal(m.product === "gunw", s.kind === "interferogram", s.id);
    assert.deepEqual(s.acquisitions.map((a) => a.referenceDate), [m.before.referenceDate, m.after.referenceDate], s.id);
    assert.deepEqual([s.lat, s.lon], m.center, s.id);
    assert.deepEqual(s.bbox, m.bbox, s.id);
    assert.deepEqual(s.acquisitions.map((a) => a.date), [m.before.date, m.after.date], s.id);
    assert.deepEqual(s.polarizations, m.polarizations, s.id);
    for (const f of sceneImageFiles(m)) assert.ok(existsSync(join(SCENE_IMAGES_DIR, s.id, f)), `${s.id}/${f}`);
    // a órbita mostrada na cena é a do manifest
    const [track, dir] = m.stack.split("_");
    assert.equal(s.facts[1].value, `Track ${Number(track)}, ${dir === "A" ? "ascending" : "descending"}`, s.id);
  }
});

test("no manifest real, cada granule é da órbita e da data da passagem, e a versão acompanha o CRID", () => {
  const real = readManifest();
  const byCrid = new Map<string, string>();
  for (const [id, m] of Object.entries(real.scenes ?? {})) {
    for (const when of ["before", "after"] as const) {
      const { date, granule, release, referenceDate } = m[when];
      const part = granule.split("_");
      const day = (d: string) => d.replace(/-/g, "");
      assert.ok(granule.includes(`_${m.stack}_`), `${id} ${when}: órbita`);
      assert.ok(release === "beta" || release === "provisional" || release === "validated", `${id} ${when}: versão`);
      // o nome de um interferograma (GUNW) traz o começo e o fim das duas passagens do par; o do GCOV, de uma só
      const gunw = m.product === "gunw";
      assert.equal(granule.includes("_GUNW_"), gunw, `${id} ${when}: produto`);
      if (gunw) {
        assert.ok(referenceDate && part[11].startsWith(day(referenceDate)), `${id} ${when}: primeira passagem`);
        assert.ok(part[13].startsWith(day(date)), `${id} ${when}: segunda passagem`);
        assert.ok(referenceDate! < date, `${id} ${when}: ordem do par`);
      } else {
        assert.equal(referenceDate, undefined, `${id} ${when}: só interferograma tem par`);
        assert.ok(part[11].startsWith(day(date)), `${id} ${when}: data`);
      }
      // granules do mesmo produto processadas pela mesma versão do software (CRID) estão na mesma coleção do catálogo
      const crid = `${gunw ? "GUNW" : "GCOV"} ${part[gunw ? 15 : 13]}`;
      assert.match(crid, / [A-Z]\d{5}$/, `${id} ${when}: CRID`);
      assert.equal(byCrid.get(crid) ?? release, release, `${id} ${when}: ${crid}`);
      byCrid.set(crid, release);
    }
  }
  assert.ok(byCrid.size >= 2);
});

test("fontes, ressalva e notas de exemplo na fixture, nos dois idiomas", () => {
  for (const lang of ["en", "pt"] as Lang[]) {
    const seasonal = lang === "pt" ? "Mudança sazonal" : "Seasonal change";
    for (const s of scenes(lang)) {
      // evento documentado só com fonte; cena sazonal é a nossa leitura do par
      assert.equal(s.basis === "documented-event", Boolean(s.sources?.length), s.id);
      assert.equal(s.basis === "interpretation", s.event === seasonal, s.id);
      for (const src of s.sources ?? []) {
        assert.ok(src.url.startsWith("https://"), s.id);
        assert.ok(src.title.trim().length > 20, s.id);
      }
      if (s.caveat !== undefined) assert.ok(s.caveat.length > 0 && s.caveat.length <= 280, `${s.id}: ${s.caveat.length}`);
      // granule, versão e detalhes da imagem são do manifest, nunca da fixture
      assert.equal("imageryDetails" in s || "imagery" in s, false, s.id);
      assert.ok(s.acquisitions.every((a) => !("granule" in a) && !("release" in a)), s.id);
    }
    assert.ok(criteria(lang).every((c) => c.isExample === true));
  }
  const en = scenes("en"), pt = scenes("pt");
  assert.deepEqual(en.filter((s) => s.sources).map((s) => s.id), ["taquari", "chokwe"]);
  assert.deepEqual(en.map((s) => s.sources?.map((x) => x.url)), pt.map((s) => s.sources?.map((x) => x.url)));
  assert.notEqual(en[0].sources![0].title, pt[0].sources![0].title);
  assert.notEqual(en[0].caveat, pt[0].caveat);
});

test("as cenas servidas levam o que vem da fixture e o que vem do manifest", () => {
  const { criteria: served, scenes: list } = servedScenes("en");
  const real = readManifest().scenes!;
  assert.equal(served.length, criteria("en").length);
  assert.deepEqual(list.map((s) => s.id), scenes("en").map((s) => s.id));
  for (const s of list) {
    assert.equal(s.imagery, "gcov", s.id);
    // duas passagens por cena, mais as anteriores que o manifest trouxer (hoje, só o Taquari)
    assert.equal(s.acquisitions.length, 2 + (real[s.id].earlier?.length ?? 0), s.id);
    assert.deepEqual(s.acquisitions.map((a) => a.date), s.acquisitions.map((a) => a.date).sort(), s.id);
    for (const a of s.acquisitions) {
      assert.ok(a.granule && a.release, s.id);
      for (const p of s.polarizations) assert.ok((a.images[p] ?? "").startsWith(`/api/scene-images/${s.id}/`), s.id);
    }
    assert.deepEqual(Object.keys(s.imageryDetails?.topDb ?? {}), s.polarizations, s.id);
    assert.ok((s.imageryDetails?.validPct ?? 0) > 99, s.id);
  }
  const taquari = list[0];
  assert.equal(taquari.basis, "documented-event");
  assert.equal(taquari.sources?.length, 2);
  assert.ok(taquari.caveat);
  // Chókwè compara duas passagens da versão beta; o Taquari, duas provisórias
  assert.deepEqual(list.find((s) => s.id === "chokwe")!.acquisitions.map((a) => a.release), ["beta", "beta"]);
  // a série mais longa do Taquari: quatro passagens provisórias da mesma órbita, e o par da fixture são as duas últimas
  const m = real.taquari;
  assert.deepEqual(taquari.acquisitions.map((a) => a.date), ["2026-06-17", "2026-06-29", "2026-07-11", "2026-07-23"]);
  assert.deepEqual(taquari.acquisitions.map((a) => a.release), ["provisional", "provisional", "provisional", "provisional"]);
  assert.equal(usableEarlier(m).length, m.earlier?.length);
  for (const a of taquari.acquisitions) {
    assert.ok(a.granule?.includes(`_${m.stack}_`), a.date);
    assert.ok(a.granule?.split("_")[11].startsWith(a.date.replace(/-/g, "")), a.date);
  }
});

test("a versão das imagens muda quando o manifest da cena muda", () => {
  const m = manifest.scenes!.sindh;
  assert.equal(imageVersion(m), imageVersion({ ...m }));
  assert.notEqual(imageVersion(m), imageVersion({ ...m, bbox: [68.1, 25.6, 68.9, 26.4] }));
  assert.notEqual(imageVersion(m), imageVersion({ ...m, after: { date: "2026-09-21", granule: "c" } }));
});

test("sem arquivo, sem manifest ou com centro diferente, a cena fica com o exemplo", () => {
  assert.equal(withSceneImages([sindh], manifest, "/x", () => false)[0], sindh);
  assert.equal(withSceneImages([sindh], {}, "/x", () => true)[0], sindh);
  const moved = { ...sindh, lat: 27.25 };
  assert.equal(withSceneImages([moved], manifest, "/x", () => true)[0], moved);
});

test("manifest de outro formato vale como manifest ausente: a cena fica com o exemplo, sem erro", () => {
  const entry = manifest.scenes!.sindh;
  const broken: unknown[] = [
    [], { scenes: null }, { scenes: [] }, { scenes: "x" }, { scenes: { sindh: null } }, { scenes: { sindh: "x" } },
    { scenes: { sindh: { ...entry, center: undefined } } }, { scenes: { sindh: { ...entry, center: ["24.9", 67.9] } } },
    { scenes: { sindh: { ...entry, bbox: [67, 24, 68] } } }, { scenes: { sindh: { ...entry, polarizations: "HH" } } },
    { scenes: { sindh: { ...entry, polarizations: ["VV"] } } }, { scenes: { sindh: { ...entry, before: undefined } } },
    { scenes: { sindh: { ...entry, after: { granule: "x" } } } },
    { scenes: { sindh: { ...entry, after: { ...entry.after, date: "23/07/2026" } } } },
  ];
  for (const m of broken) {
    assert.equal(withSceneImages([sindh], m as SceneImageManifest, "/x", () => true)[0], sindh, JSON.stringify(m));
  }
  // a entrada inteira continua valendo
  assert.notEqual(withSceneImages([sindh], manifest, "/x", () => true)[0], sindh);
  // arquivo que não é um objeto, ou que nem é JSON, lê como manifest vazio
  const dir = mkdtempSync(join(tmpdir(), "nexxus-manifest-"));
  try {
    for (const text of ["null", "12", '"x"', "[]", "{", ""]) {
      writeFileSync(join(dir, "manifest.json"), text);
      assert.equal(withSceneImages([sindh], readManifest(dir), "/x", () => true)[0], sindh, text);
    }
    writeFileSync(join(dir, "manifest.json"), JSON.stringify(manifest));
    assert.deepEqual(readManifest(dir), manifest);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("include=interferogram é o único tipo de cena que se pede; o resto é ignorado", () => {
  assert.deepEqual(parseInclude("interferogram"), ["interferogram"]);
  assert.deepEqual(parseInclude("backscatter, interferogram"), ["interferogram"]);
  assert.deepEqual(parseInclude(["x", "interferogram"]), ["interferogram"]);
  for (const raw of [undefined, "", "Interferogram", "interferograms", 3, { interferogram: true }, ["x"]]) {
    assert.deepEqual(parseInclude(raw), [], String(raw));
  }
});

// cena de interferograma, como a fixture a monta: duas imagens, cada uma de um par de passagens
const quake: Scene = {
  ...sindh, id: "quake", kind: "interferogram", polarizations: ["HH"],
  acquisitions: [
    { date: "2026-06-18", referenceDate: "2026-06-06", images: { HH: null } },
    { date: "2026-06-30", referenceDate: "2026-06-18", images: { HH: null } },
  ],
};
const quakeEntry: SceneImageEntry = {
  center: [quake.lat, quake.lon], bbox: [68.2, 25.7, 68.8, 26.3], stack: "061_A_007", polarization: "HH", polarizations: ["HH"],
  before: { date: "2026-06-18", referenceDate: "2026-06-06", granule: "a", release: "provisional" },
  after: { date: "2026-06-30", referenceDate: "2026-06-18", granule: "b", release: "provisional" },
  product: "gunw", validPct: 91.5, cycleCm: 11.9,
};

test("interferograma com imagens sai com os pares, a origem e os centímetros por ciclo", () => {
  const out = withSceneImages([sindh, quake], { scenes: { ...manifest.scenes, quake: quakeEntry } }, "/x", () => true);
  assert.deepEqual(out.map((s) => s.id), ["sindh", "quake"]);
  const s = out[1];
  assert.equal(s.kind, "interferogram");
  assert.equal(s.imagery, "gunw");
  assert.equal(s.cycleCm, 11.9);
  assert.deepEqual(s.bbox, quakeEntry.bbox);
  assert.deepEqual(s.acquisitions.map((a) => [a.referenceDate, a.date, a.granule, a.release]),
    [["2026-06-06", "2026-06-18", "a", "provisional"], ["2026-06-18", "2026-06-30", "b", "provisional"]]);
  assert.ok(s.acquisitions.every((a) => a.images.HH?.startsWith("/x/quake/")));
  // a escala de cinza é do dado de brilho: no interferograma só vai a parte válida
  assert.deepEqual(s.imageryDetails, { validPct: 91.5 });
  // cena de brilho não ganha campo de interferograma
  assert.equal("cycleCm" in out[0] || "referenceDate" in out[0].acquisitions[0], false);
});

test("interferograma sem imagem de fase não tem exemplo que o substitua: sai da lista", () => {
  const ids = (entry?: SceneImageEntry, exists = true) =>
    withSceneImages([sindh, quake], { scenes: entry ? { quake: entry } : {} }, "/x", () => exists).map((s) => s.id);
  assert.deepEqual(ids(quakeEntry), ["sindh", "quake"]);
  assert.deepEqual(ids(), ["sindh"], "sem entrada no manifest");
  assert.deepEqual(ids(quakeEntry, false), ["sindh"], "sem arquivos");
  assert.deepEqual(ids({ ...quakeEntry, center: [1, 2] }), ["sindh"], "imagens de outro lugar");
  assert.deepEqual(ids({ ...quakeEntry, product: "gcov" }), ["sindh"], "imagem de brilho não serve de fase");
  assert.deepEqual(ids({ ...quakeEntry, before: { date: "2026-06-18", granule: "a" } }), ["sindh"], "par sem a primeira data");
  assert.deepEqual(ids({ ...quakeEntry, after: { ...quakeEntry.after, referenceDate: "18/06/2026" } }), ["sindh"], "data malformada");
  assert.deepEqual(ids({ ...quakeEntry, polarizations: ["HV"] }), ["sindh"], "a fase só vem em HH");
  assert.deepEqual(ids({ ...quakeEntry, polarizations: ["HH", "HV"] }), ["sindh"], "e só nela");
  // imagem de fase também não vira imagem de uma cena de brilho: ela fica com o exemplo
  const phase: SceneImageManifest = { scenes: { sindh: { ...manifest.scenes!.sindh, product: "gunw" } } };
  assert.equal(withSceneImages([sindh], phase, "/x", () => true)[0], sindh);
  // ciclo sem número válido não vira campo
  const noCycle = withSceneImages([quake], { scenes: { quake: { ...quakeEntry, cycleCm: 0 } } }, "/x", () => true)[0];
  assert.equal("cycleCm" in noCycle, false);
});

test("a cena de La Guaira, com as imagens reais: dois pares, um antes dos terremotos e um que os atravessa", () => {
  const QUAKE = "2026-06-24";
  const m = readManifest().scenes!.laguaira;
  assert.equal(m.product, "gunw");
  assert.deepEqual(m.polarizations, ["HH"]);
  for (const lang of ["en", "pt"] as Lang[]) {
    const list = servedScenes(lang, ["interferogram"]).scenes;
    const s = list[list.length - 1];
    assert.equal(s.id, "laguaira");
    assert.equal(list.filter((x) => x.kind === "interferogram").length, 1);
    assert.equal(s.kind, "interferogram");
    assert.equal(s.imagery, "gunw");
    assert.deepEqual(s.bbox, m.bbox);
    const [before, after] = s.acquisitions;
    assert.ok(before.referenceDate! < before.date && before.date < QUAKE, "o primeiro par termina antes dos terremotos");
    assert.ok(after.referenceDate! < QUAKE && QUAKE < after.date, "o segundo par atravessa os terremotos");
    // os dois pares têm uma passagem em comum: é o que a ressalva usa para dizer de onde vem a mancha do sudeste
    assert.equal(before.date, after.referenceDate);
    for (const a of s.acquisitions) {
      assert.ok(a.images.HH?.startsWith("/api/scene-images/laguaira/"), lang);
      assert.equal(a.release, "provisional");
      assert.ok(a.granule?.includes("_GUNW_"));
    }
    // meio comprimento de onda da banda L: cerca de 12 cm de mudança na distância até o satélite por ciclo de cor
    assert.equal(s.cycleCm, m.cycleCm);
    assert.ok(s.cycleCm! > 11.5 && s.cycleCm! < 12.5);
    // sem escala de cinza; a parte com sinal confiável nos dois pares, como está no manifest
    assert.deepEqual(s.imageryDetails, { validPct: m.validPct });
    assert.ok(m.validPct! > 20 && m.validPct! < 100);
    assert.equal(s.basis, "documented-event");
    assert.equal(s.sources?.length, 1);
    assert.ok(s.sources![0].url.startsWith("https://science.nasa.gov/"));
    assert.ok(s.caveat && s.caveat.length <= 280, String(s.caveat?.length));
    assert.equal("waterSeries" in s || "riverGauge" in s || "areaKm2" in s, false);
    // centímetros vêm de `cycleCm`, não do texto; e o resumo não diz para que lado o chão andou (a imagem não dá)
    assert.doesNotMatch(s.summary + s.caveat, /\d\s?cm|centim|centím/i);
    assert.doesNotMatch(s.summary, /westward|eastward|northward|southward|upward|downward|para oeste|para leste|para norte|para sul|para cima|para baixo/i);
    // sem o pedido, a lista é a de sempre
    assert.equal(servedScenes(lang).scenes.some((x) => x.id === "laguaira"), false);
  }
  const [en, pt] = (["en", "pt"] as Lang[]).map((lang) => scenes(lang, ["interferogram"]).find((x) => x.id === "laguaira")!);
  assert.notEqual(en.summary, pt.summary);
  assert.notEqual(en.caveat, pt.caveat);
  assert.deepEqual(en.sources!.map((x) => x.url), pt.sources!.map((x) => x.url));
});

test("sem include, só cenas de brilho, na ordem de sempre; a de interferograma entra a pedido, no fim", () => {
  for (const lang of ["en", "pt"] as Lang[]) {
    const base = scenes(lang), all = scenes(lang, ["interferogram"]);
    assert.ok(base.every((s) => s.kind === undefined));
    assert.deepEqual(all.slice(0, base.length), base);
    assert.ok(all.slice(base.length).every((s) => s.kind === "interferogram"));
    assert.deepEqual(servedScenes(lang).scenes.map((s) => s.id), base.map((s) => s.id));
    assert.deepEqual(servedScenes(lang, ["interferogram"]).scenes.slice(0, base.length).map((s) => s.id), base.map((s) => s.id));
  }
});

test("série mais longa: passagens anteriores do manifest entram antes das duas, com imagem, granule e versão", () => {
  const entry: SceneImageEntry = {
    ...manifest.scenes!.sindh, product: "gcov",
    earlier: [{ date: "2026-05-24", granule: "x", release: "provisional" }, { date: "2026-06-05", granule: "y" }],
  };
  const asked: string[] = [];
  const out = withSceneImages([sindh], { scenes: { sindh: entry } }, "/api/scene-images", (_, files) => { asked.push(...files); return true; })[0];
  const v = `?v=${imageVersion(entry)}`;
  assert.deepEqual(out.acquisitions.map((a) => a.date), ["2026-05-24", "2026-06-05", "2026-06-17", "2026-09-09"]);
  assert.deepEqual(out.acquisitions[0], {
    date: "2026-05-24", granule: "x", release: "provisional",
    images: { HH: `/api/scene-images/sindh/earlier-2026-05-24-HH.png${v}`, HV: `/api/scene-images/sindh/earlier-2026-05-24-HV.png${v}` },
  });
  assert.equal(out.acquisitions[1].release, undefined);
  assert.deepEqual(earlierImageFiles(entry, "2026-06-05"), ["earlier-2026-06-05-HH.png", "earlier-2026-06-05-HV.png"]);
  assert.ok(asked.includes("earlier-2026-05-24-HV.png"));
});

test("série mais longa só entra inteira: sem arquivo, fora de ordem, depois da before ou fora do dado calibrado, ficam as duas", () => {
  const base = manifest.scenes!.sindh;
  const two = (entry: SceneImageEntry, exists: (id: string, files: string[]) => boolean = () => true) =>
    withSceneImages([sindh], { scenes: { sindh: entry } }, "/api/scene-images", exists)[0].acquisitions.map((a) => a.date);
  const good = [{ date: "2026-05-24", granule: "x" }, { date: "2026-06-05", granule: "y" }];
  // falta um arquivo de uma das passagens anteriores
  assert.deepEqual(two({ ...base, product: "gcov", earlier: good }, (_, files) => !files.some((f) => f.startsWith("earlier-2026-06-05"))), ["2026-06-17", "2026-09-09"]);
  assert.deepEqual(two({ ...base, product: "gcov", earlier: [...good].reverse() }), ["2026-06-17", "2026-09-09"]);
  assert.deepEqual(two({ ...base, product: "gcov", earlier: [{ date: "2026-06-17", granule: "x" }] }), ["2026-06-17", "2026-09-09"]);
  assert.deepEqual(two({ ...base, product: "gcov", earlier: [{ date: "ontem", granule: "x" }] }), ["2026-06-17", "2026-09-09"]);
  // preview: cada data tem o seu contraste, não dá série
  assert.deepEqual(two({ ...base, earlier: good }), ["2026-06-17", "2026-09-09"]);
  assert.deepEqual(usableEarlier({ ...base, product: "gcov", earlier: "x" as unknown as SceneImageEntry["earlier"] }), []);
});
