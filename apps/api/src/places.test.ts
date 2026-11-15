import { test } from "node:test";
import assert from "node:assert/strict";
import { foldName } from "@nexxus/contract";
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

test("acha nomes com letras que não são acento, digitados sem elas", async () => {
  // ł, ı, ø e ß não se desfazem na decomposição de acentos; o apóstrofo curvo ninguém digita
  for (const [typed, name, cc] of [["Lodz", "Łódź", "PL"], ["Diyarbakir", "Diyarbakır", "TR"], ["Tromso", "Tromsø", "NO"], ["Giessen", "Gießen", "DE"], ["N'Djamena", "N’Djamena", "TD"]]) {
    const hits = await places.search(typed, { kind: "city", lang: "en" });
    assert.ok(hits.some((p) => p.countryCode === cc && foldName(p.name) === foldName(name)), `${typed}: ${hits.map((p) => p.name).join(", ")}`);
  }
  assert.equal(foldName("Łódź"), "lodz");
  assert.equal(foldName("Gießen"), "giessen");
  assert.equal(foldName("São Paulo"), "sao paulo");
});

test("países e territórios que faltavam entram na busca", async () => {
  const hits = await places.search("Tuvalu", { kind: "country", lang: "en" });
  assert.equal(hits[0]?.countryCode, "TV");
});

test("povoado fora da lista, dentro de um estado: a busca online aceita o nome do estado no idioma pedido", async () => {
  process.env.PLACES_ONLINE = "1";
  const online = new PlacesService();
  process.env.PLACES_ONLINE = "0";
  const realFetch = globalThis.fetch;
  try {
    for (const [lang, admin1] of [["pt", "Baviera"], ["en", "Bavaria"]] as const) {
      // o Open-Meteo devolve o estado no idioma pedido; o identificador do estado na busca é o nome em inglês
      globalThis.fetch = (async () => new Response(JSON.stringify({
        results: [{ name: "Xyzdorf", latitude: 48, longitude: 11, admin1, country: "Germany", country_code: "DE" }],
      }))) as typeof fetch;
      const hits = await online.search("Xyzdorf", { kind: "city", lang, countryCode: "DE", adminKey: "Bavaria" });
      assert.deepEqual(hits.map((p) => p.name), ["Xyzdorf"], lang);
    }
    // cidade de outro estado continua de fora
    globalThis.fetch = (async () => new Response(JSON.stringify({
      results: [{ name: "Xyzdorf", latitude: 51, longitude: 9, admin1: "Hessen", country: "Germany", country_code: "DE" }],
    }))) as typeof fetch;
    assert.deepEqual(await online.search("Xyzdorf", { kind: "city", lang: "pt", countryCode: "DE", adminKey: "Bavaria" }), []);
  } finally {
    globalThis.fetch = realFetch;
  }
});
