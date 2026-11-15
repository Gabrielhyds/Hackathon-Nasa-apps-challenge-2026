import "reflect-metadata";
import { test } from "node:test";
import assert from "node:assert/strict";
import { BadRequestException } from "@nestjs/common";
import { PassesController, PlacesController, ScenesController } from "./controllers";
import { PassesService } from "./passes.service";
import { PlacesService } from "./places.service";

// sem rede: passagens de exemplo e só a lista embutida de lugares
process.env.PASSES_ONLINE = "0";
process.env.PLACES_ONLINE = "0";
const passes = new PassesController(new PassesService());
const places = new PlacesController(new PlacesService());

test("parâmetro repetido na query vale pelo primeiro, em vez de derrubar a rota", async () => {
  // ?lat=1&lat=2&lon=3: o Express entrega uma lista
  assert.ok((await passes.list(["1", "2"], "3")).length > 0);
  // ?q=Campinas&q=x
  const hits = await places.search(["Campinas", "x"], "city", ["pt", "en"]);
  assert.equal(hits[0].name, "Campinas");
  assert.equal(new ScenesController().list(["pt", "en"]).criteria[0].label, new ScenesController().list("pt").criteria[0].label);
});

test("parâmetro com colchetes (objeto) conta como ausente", async () => {
  assert.throws(() => passes.list({ a: "1" }, "3"), BadRequestException);
  assert.deepEqual(await places.search({ a: "Campinas" }), []);
  // país e estado malformados não restringem nem quebram a busca
  const hits = await places.search("Campinas", undefined, "pt", ["BR"], { x: "1" });
  assert.equal(hits[0].countryCode, "BR");
});

test("lat e lon continuam conferidos", () => {
  assert.throws(() => passes.list("abc", "1"), BadRequestException);
  assert.throws(() => passes.list("91", "0"), BadRequestException);
  assert.throws(() => passes.list(undefined, "0"), BadRequestException);
});
