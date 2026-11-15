import type { AskRequest, Criterion, Release, Scene, ScenesResponse } from "@nexxus/contract";

/** Uma passagem comparada, como vai ao agente: sem o endereço da imagem. */
export interface AgentPass {
  date: string;
  granule?: string;
  /** Versão do produto: beta, provisória ou validada. */
  release?: Release;
}

/** Um par de passagens de um interferograma: de `referenceDate` a `date`. */
export interface AgentPair extends AgentPass {
  referenceDate?: string;
}

/** Uma cena em contexto, como vai ao agente. Campo ausente na cena some do JSON. */
export interface AgentScene extends Pick<Scene,
  "id" | "name" | "event" | "region" | "summary" | "scores" | "facts" | "polarizations" | "kind" | "basis" | "sources" |
  "caveat" | "imagery" | "imageryDetails" | "cycleCm" | "waterSeries" | "riverGauge" | "opticalDay"> {
  /** Só em cena de brilho: o sentido da mudança, as datas e as passagens comparadas. */
  change?: Scene["change"];
  passDates?: string[];
  passes?: AgentPass[];
  /** Só em interferograma: os pares de passagens, um por imagem. */
  pairs?: AgentPair[];
}

export interface AgentBody {
  question: string;
  history: NonNullable<AskRequest["history"]>;
  lang: NonNullable<AskRequest["lang"]>;
  criteria: Criterion[];
  scenes: AgentScene[];
}

/**
 * Corpo enviado à API do agente: a pergunta, a conversa, os critérios do ranking e as cenas em contexto, como a
 * API as serve em `GET /scenes`, só com o que o agente precisa para responder com cuidado:
 *
 * - `criteria`: os critérios das notas; `isExample: true` diz que as notas são inventadas, não medidas.
 * - `basis`, `sources`, `caveat`: em que a cena se apoia (evento documentado ou leitura do time), as fontes e a
 *   ressalva de leitura da imagem.
 * - `imagery`, `imageryDetails`: de onde vem a imagem e a escala dela.
 * - `waterSeries`, `riverGauge`: só no Taquari, a água aberta nova medida em cada passagem (com o método) e as
 *   leituras do nível do rio, cada uma com a fonte. É outra medida, não a do mapa de mudança.
 * - `opticalDay`: só no Taquari, o dia, o satélite e a frase da imagem óptica que a tela põe em volta do radar.
 * - `passes`: data, granule e versão do produto (beta, provisória, validada) de cada passagem comparada;
 *   `passDates` continua indo, só com as datas.
 * - Cena de interferograma (`kind: "interferogram"`): no lugar de `change`, `passDates` e `passes` vão `pairs`
 *   (cada imagem é um par de passagens) e `cycleCm` (centímetros por ciclo de cor). Não há brilho para comparar.
 *
 * Os endereços das imagens ficam de fora: o agente não as vê. Sem cena marcada na pergunta, vão todas as de
 * brilho; a de interferograma só vai quando o front a manda em `sceneIds`, isto é, quando sabe mostrá-la.
 * Campo ausente na cena some do JSON.
 */
export function agentBody(req: AskRequest, served: ScenesResponse): AgentBody {
  const chosen = served.scenes.filter((s) => req.sceneIds.includes(s.id));
  const scenes = chosen.length ? chosen : served.scenes.filter((s) => s.kind !== "interferogram");
  return {
    question: req.question,
    history: req.history ?? [],
    lang: req.lang ?? "en",
    criteria: served.criteria,
    scenes: scenes.map((s): AgentScene => {
      const passes: AgentPass[] = s.acquisitions.map((a) => ({ date: a.date, granule: a.granule, release: a.release }));
      const compared: Pick<AgentScene, "change" | "passDates" | "passes" | "pairs" | "cycleCm"> = s.kind === "interferogram"
        ? { pairs: s.acquisitions.map((a, i) => ({ referenceDate: a.referenceDate, ...passes[i] })), cycleCm: s.cycleCm }
        : { change: s.change, passDates: passes.map((p) => p.date), passes };
      return {
        id: s.id, name: s.name, event: s.event, region: s.region, summary: s.summary, scores: s.scores, facts: s.facts,
        kind: s.kind, polarizations: s.polarizations, ...compared,
        basis: s.basis, sources: s.sources, caveat: s.caveat, imagery: s.imagery, imageryDetails: s.imageryDetails,
        waterSeries: s.waterSeries, riverGauge: s.riverGauge, opticalDay: s.opticalDay,
      };
    }),
  };
}
