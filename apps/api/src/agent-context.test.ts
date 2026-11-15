import { test } from "node:test";
import assert from "node:assert/strict";
import { mockAsk } from "@nexxus/contract";
import type { AskRequest, Scene } from "@nexxus/contract";
import { agentBody } from "./agent-context";
import { servedScenes } from "./scene-images";

const ask = (sceneIds: string[], lang: "en" | "pt" = "en"): AskRequest => ({ question: "What changed?", sceneIds, lang });

test("o corpo enviado ao agente leva a base, as fontes, a ressalva e a versão de cada passagem", () => {
  const body = agentBody(ask(["taquari"]), servedScenes("en"));
  assert.equal(body.question, "What changed?");
  assert.deepEqual(body.history, []);
  assert.equal(body.lang, "en");
  assert.ok(body.criteria.length > 0 && body.criteria.every((c) => c.isExample === true));
  assert.deepEqual(body.scenes.map((s) => s.id), ["taquari"]);
  const s = body.scenes[0];
  assert.equal(s.basis, "documented-event");
  assert.equal(s.sources?.length, 2);
  assert.ok(s.caveat);
  assert.equal(s.imagery, "gcov");
  assert.deepEqual(s.imageryDetails, { topDb: { HH: 0, HV: -6 }, validPct: 100 });
  assert.deepEqual(s.passDates, ["2026-07-11", "2026-07-23"]);
  assert.deepEqual(s.passes?.map((p) => [p.date, p.release]), [["2026-07-11", "provisional"], ["2026-07-23", "provisional"]]);
  assert.ok(s.passes?.every((p) => p.granule?.includes("_053_D_103_")));
  // cena de brilho não leva campo de interferograma
  assert.equal(s.kind, undefined);
  assert.equal(s.pairs, undefined);
});

test("o agente não recebe endereço de imagem, e campo ausente some do JSON", () => {
  const json = JSON.stringify(agentBody(ask(["sindh"], "pt"), servedScenes("pt")));
  assert.equal(json.includes("/scene-images/"), false);
  const scene = (JSON.parse(json) as { scenes: Record<string, unknown>[] }).scenes[0];
  assert.equal(scene.basis, "interpretation");
  assert.equal("sources" in scene, false);
  assert.equal("caveat" in scene, false);
  assert.equal(scene.event, "Mudança sazonal");
});

test("sem cena marcada, ou com id desconhecido, o agente recebe todas", () => {
  const served = servedScenes("en");
  assert.equal(agentBody(ask([]), served).scenes.length, served.scenes.length);
  assert.equal(agentBody(ask(["nowhere"]), served).scenes.length, served.scenes.length);
});

test("a resposta de exemplo sobre o Taquari traz a ressalva da cena, no idioma pedido", () => {
  for (const lang of ["en", "pt"] as const) {
    const served = servedScenes(lang).scenes;
    const caveat = served.find((s) => s.id === "taquari")!.caveat!;
    assert.ok(mockAsk(ask(["taquari"], lang), served).answer.includes(caveat));
    assert.ok(mockAsk(ask(["taquari"], lang)).answer.includes(caveat));
    // cena sem ressalva: a resposta fica como era
    const sindh = served.find((s) => s.id === "sindh")!;
    assert.ok(mockAsk(ask(["sindh"], lang), served).answer.endsWith(sindh.summary));
  }
});

test("a cena de La Guaira chega ao agente como a API a serve: os dois pares, o ciclo, a fonte e a ressalva", () => {
  const served = servedScenes("en", ["interferogram"]);
  const json = JSON.stringify(agentBody(ask(["laguaira"]), served));
  assert.equal(json.includes("/scene-images/"), false);
  const [s] = agentBody(ask(["laguaira"]), served).scenes;
  assert.equal(s.id, "laguaira");
  assert.equal(s.kind, "interferogram");
  assert.equal(s.imagery, "gunw");
  assert.deepEqual(s.pairs?.map((p) => [p.referenceDate, p.date, p.release]),
    [["2026-06-06", "2026-06-18", "provisional"], ["2026-06-18", "2026-06-30", "provisional"]]);
  assert.ok(s.pairs?.every((p) => p.granule?.includes("_GUNW_")));
  assert.ok(s.cycleCm && s.cycleCm > 11.5 && s.cycleCm < 12.5);
  assert.equal(s.basis, "documented-event");
  assert.equal(s.sources?.length, 1);
  assert.ok(s.caveat);
  for (const key of ["change", "passDates", "passes", "waterSeries", "riverGauge"]) assert.equal(key in JSON.parse(json).scenes[0], false, key);
  // sem a cena marcada na pergunta, ela não vai ao agente, mesmo servida; e a resposta de exemplo não a escolhe
  assert.equal(agentBody(ask([]), served).scenes.some((x) => x.id === "laguaira"), false);
  assert.equal(mockAsk(ask([]), served.scenes).citations.some((c) => c.sceneId === "laguaira"), false);
  // marcada, a resposta de exemplo leva o resumo e a ressalva dela
  const answer = mockAsk(ask(["laguaira"]), served.scenes).answer;
  assert.ok(answer.includes(s.summary) && answer.includes(s.caveat!));
});

test("interferograma: só vai ao agente quando a pergunta o marca, com os pares no lugar das passagens", () => {
  const served = servedScenes("en");
  const quake: Scene = {
    ...served.scenes[0], id: "quake", kind: "interferogram", imagery: "gunw", cycleCm: 11.9, polarizations: ["HH"],
    acquisitions: [
      { date: "2026-06-18", referenceDate: "2026-06-06", images: { HH: "/api/scene-images/quake/before-HH.png" }, granule: "a", release: "provisional" },
      { date: "2026-06-30", referenceDate: "2026-06-18", images: { HH: "/api/scene-images/quake/after-HH.png" }, granule: "b", release: "provisional" },
    ],
  };
  const withQuake = { ...served, scenes: [...served.scenes, quake] };
  // sem cena marcada, o front pode nem conhecer a cena: vão só as de brilho
  assert.deepEqual(agentBody(ask([]), withQuake).scenes.map((s) => s.id), served.scenes.map((s) => s.id));
  const json = JSON.stringify(agentBody(ask(["quake"]), withQuake));
  assert.equal(json.includes("/scene-images/"), false);
  const [s] = (JSON.parse(json) as { scenes: Record<string, unknown>[] }).scenes;
  assert.equal(s.id, "quake");
  assert.equal(s.kind, "interferogram");
  assert.equal(s.imagery, "gunw");
  assert.equal(s.cycleCm, 11.9);
  assert.deepEqual(s.pairs, [
    { referenceDate: "2026-06-06", date: "2026-06-18", granule: "a", release: "provisional" },
    { referenceDate: "2026-06-18", date: "2026-06-30", granule: "b", release: "provisional" },
  ]);
  // não há brilho para comparar: nem sentido da mudança, nem lista de passagens
  for (const key of ["change", "passDates", "passes"]) assert.equal(key in s, false, key);
});
