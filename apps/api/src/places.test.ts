import { test } from "node:test";
import assert from "node:assert/strict";
import { PlacesService } from "./places.service";

process.env.PLACES_ONLINE = "0";
const places = new PlacesService();

test("a lista completa de cidades é carregada ao subir", () => {
  assert.ok(places.cities > 200_000, `só ${places.cities} cidades`);
});

test("acha cidade pequena, com estado e país, sem rede", async () => {
  const hits = await places.search("Oiapoque", { kind: "city", lang: "pt" });
  assert.deepEqual([hits[0].name, hits[0].admin, hits[0].countryCode], ["Oiapoque", "Amapá", "BR"]);
});

test("acha pelo nome em português e pelo nome em inglês", async () => {
  assert.equal((await places.search("Munique", { kind: "city", lang: "pt" }))[0].name, "Munique");
  assert.equal((await places.search("Munich", { kind: "city", lang: "en" }))[0].name, "Munich");
});

test("homônimas: a mais populosa primeiro, e o filtro de país e estado separa as outras", async () => {
  const all = await places.search("Campinas", { kind: "city", lang: "pt" });
  assert.equal(all[0].admin, "São Paulo");
  const sc = await places.search("Campinas", { kind: "city", lang: "pt", countryCode: "BR", adminKey: "Santa Catarina" });
  assert.deepEqual(sc.map((p) => p.admin), ["Santa Catarina"]);
});

test("lista as cidades de um estado sem texto, até cem", async () => {
  const amapa = await places.search("", { kind: "city", lang: "pt", countryCode: "BR", adminKey: "Amapá" });
  assert.ok(amapa.length >= 10 && amapa.length <= 100);
  assert.ok(amapa.every((p) => p.kind === "city" && p.countryCode === "BR"));
});

test("países e territórios que faltavam entram na busca", async () => {
  const hits = await places.search("Tuvalu", { kind: "country", lang: "en" });
  assert.equal(hits[0]?.countryCode, "TV");
});
