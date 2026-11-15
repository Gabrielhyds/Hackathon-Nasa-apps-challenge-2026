import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { mockAsk } from "@nexxus/contract";
import type { AskRequest } from "@nexxus/contract";
import { QUESTION_MAX, agentBody, agentResponse } from "./agent-context";
import { servedScenes } from "./scene-images";

const ask = (sceneIds: string[], lang: "en" | "pt" = "en"): AskRequest => ({ question: "What changed?", sceneIds, lang });

/** Os cartões do agente, como estão em apps/agent/data/cards.json. */
const cards = (JSON.parse(readFileSync(resolve(__dirname, "../../agent/data/cards.json"), "utf8")) as
  { cards: { id: string; tipo: string }[] }).cards;
const all = servedScenes("en", ["interferogram"]).scenes;
const known = new Set(all.map((s) => s.id));

test("o pedido ao agente leva a pergunta, o idioma e a cena aberta, e mais nada", () => {
  assert.deepEqual(agentBody(ask(["taquari", "sindh"], "pt")), { question: "What changed?", lang: "pt", scene: "taquari" });
  assert.deepEqual(agentBody(ask([])), { question: "What changed?", lang: "en" });
  assert.deepEqual(agentBody({ question: "Why?", sceneIds: [], history: [{ role: "user", content: "x" }] }), { question: "Why?", lang: "en" });
  // o agente recusa pergunta com mais de 500 caracteres
  assert.equal(agentBody({ ...ask([]), question: "a".repeat(900) }).question.length, QUESTION_MAX);
});

test("toda cena que a API serve tem cartão de cena no agente, pelo nome que ele conhece", () => {
  const sceneCards = new Set(cards.filter((c) => c.tipo === "cena").map((c) => c.id));
  for (const s of all) {
    const name = agentBody(ask([s.id])).scene;
    assert.ok(name && sceneCards.has(name), `${s.id} -> ${name}`);
  }
  assert.equal(agentBody(ask(["gelo-sul"])).scene, "campo_de_gelo_sul");
  assert.equal(agentBody(ask(["laguaira"])).scene, "venezuela");
});

test("todo cartão de cena do agente vira citação de uma cena que a API serve", () => {
  for (const c of cards.filter((x) => x.tipo === "cena" && x.id !== "sazonais")) {
    const r = agentResponse({ answer: "ok", cards: [c.id] }, known);
    assert.equal(r.citations.length, 1, c.id);
  }
});

test("a resposta do agente chega no formato do contrato: ressalvas, fontes, modo e cenas citadas", () => {
  const r = agentResponse({
    answer: " About 53 km² of new open water. ", lang: "en", mode: "model", text: "…",
    cards: ["taquari", "taquari_metodo", "radar_basico", "venezuela", "campo_de_gelo_sul"],
    caveats: ["New open water, not the flooded area.", ""],
    sources: [{ nome: "NASA Science", url: "https://science.nasa.gov/mission/nisar/" }, { nome: "sem endereço" }, { nome: "x", url: "javascript:alert(1)" }],
  }, known);
  assert.equal(r.answer, "About 53 km² of new open water.");
  // dois cartões do Taquari dão um botão só; cartão que não é de cena não vira botão
  assert.deepEqual(r.citations, [{ sceneId: "taquari" }, { sceneId: "laguaira" }, { sceneId: "gelo-sul" }]);
  assert.deepEqual(r.caveats, ["New open water, not the flooded area."]);
  assert.deepEqual(r.sources, [{ title: "NASA Science", url: "https://science.nasa.gov/mission/nisar/" }]);
  assert.equal(r.mode, "model");
  assert.equal(r.isExample, undefined);
});

test("resposta sem cartão nem fonte não leva campo vazio, e resposta sem texto é erro", () => {
  const r = agentResponse({ answer: "Nexxus doesn't have that information.", mode: "no_info", cards: [], caveats: [], sources: [] }, known);
  assert.deepEqual(r, { answer: "Nexxus doesn't have that information.", citations: [], mode: "no_info" });
  assert.equal(agentResponse({ answer: "ok", mode: "other" }, known).mode, undefined);
  assert.throws(() => agentResponse({ answer: "  " }, known));
  assert.throws(() => agentResponse(null, known));
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

test("a resposta de exemplo só fala de La Guaira quando a pergunta a marca", () => {
  const served = servedScenes("en", ["interferogram"]).scenes;
  const quake = served.find((s) => s.id === "laguaira")!;
  assert.equal(mockAsk(ask([]), served).citations.some((c) => c.sceneId === "laguaira"), false);
  const answer = mockAsk(ask(["laguaira"]), served).answer;
  assert.ok(answer.includes(quake.summary) && answer.includes(quake.caveat!));
});
