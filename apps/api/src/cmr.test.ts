import { test } from "node:test";
import assert from "node:assert/strict";
import { cmrToPasses, cmrUrl, formatPolarization, granuleToPass } from "./cmr";
import type { CmrGranule } from "./cmr";

// valores reais do CMR para Campinas (-22.9, -47.06)
const granule = (begin: string, dir: string, track: string, frame: string, pol = "HH+HV"): CmrGranule => ({
  umm: {
    GranuleUR: `NISAR_L2_PR_GCOV_${track}_${dir[0]}_${frame}_${begin}`,
    TemporalExtent: { RangeDateTime: { BeginningDateTime: begin } },
    AdditionalAttributes: [
      { Name: "ASCENDING_DESCENDING", Values: [dir] },
      { Name: "TRACK_NUMBER", Values: [track] },
      { Name: "FRAME_NUMBER", Values: [frame] },
      { Name: "FREQUENCY_A_POLARIZATION_CONCAT", Values: [pol] },
      { Name: "PRODUCT_TYPE", Values: ["GCOV"] },
      { Name: "STACK_ID", Values: [`${track.padStart(3, "0")}_${dir[0]}_${frame}`] },
    ],
  },
});

const validated = { items: [
  granule("2026-11-06T21:15:30.000000Z", "DESCENDING", "24", "100"),
  granule("2026-10-22T08:59:04.000000Z", "ASCENDING", "146", "166"),
] };
const provisional = { items: [
  granule("2026-10-13T21:15:29.000000Z", "DESCENDING", "24", "100"),
  // a mesma aquisição de 22/10 reprocessada na coleção provisória, e um quadro vizinho no mesmo dia
  granule("2026-10-22T08:59:04.000000Z", "ASCENDING", "146", "166", "HH"),
  granule("2026-10-22T08:59:40.000000Z", "ASCENDING", "146", "167"),
] };

test("converte um granule no formato do contrato", () => {
  assert.deepEqual(granuleToPass(validated.items[0]), {
    date: "2026-11-06", direction: "descending", track: 24, frame: 100, polarization: "HH + HV", product: "GCOV",
  });
});

test("descarta granule sem direção, data ou trilha", () => {
  const broken = granule("2026-11-06T21:15:30Z", "DESCENDING", "24", "100");
  broken.umm.AdditionalAttributes = broken.umm.AdditionalAttributes!.filter((a) => a.Name !== "ASCENDING_DESCENDING");
  assert.equal(granuleToPass(broken), null);
  assert.equal(granuleToPass({ umm: {} }), null);
  assert.equal(granuleToPass(granule("sem data", "ASCENDING", "1", "1")), null);
});

test("junta as coleções da mais recente para a mais antiga, sem repetir passagem", () => {
  const passes = cmrToPasses([validated, provisional, { items: [] }]);
  assert.deepEqual(passes.map((p) => p.date), ["2026-11-06", "2026-10-22", "2026-10-13"]);
  // na repetição vale a coleção validada, que vem primeiro
  const oct22 = passes.find((p) => p.date === "2026-10-22")!;
  assert.equal(oct22.polarization, "HH + HV");
  assert.equal(oct22.frame, 166);
  assert.ok(passes.every((p) => !p.isExample));
});

test("lista vazia quando nenhuma coleção cobre o ponto", () => {
  assert.deepEqual(cmrToPasses([{ items: [] }, {}, { items: [] }]), []);
});

test("polarização e endereço da busca", () => {
  assert.equal(formatPolarization("HH+HV"), "HH + HV");
  assert.equal(formatPolarization("HH"), "HH");
  const url = new URL(cmrUrl("C3622241360-ASF", -22.9, -47.06));
  assert.equal(url.searchParams.get("point"), "-47.06,-22.9");
  assert.equal(url.searchParams.get("sort_key"), "-start_date");
});
