/**
 * CONTRATO ENTRE FRONT E API.
 * O front só conhece estes formatos. Qualquer API que responda assim funciona sem mexer em tela.
 * Mudou um campo aqui? Atualize a API de exemplo (apps/api), os dados de exemplo (fixtures) e o CLAUDE.md.
 */

/** Um critério de nota do ranking. O front mostra um controle de peso para cada um. */
export interface Criterion {
  id: string;
  label: string;
  /** `true` quando as notas deste critério são inventadas, não medidas. O front avisa o usuário. */
  isExample?: boolean;
}

/** Polarizações que a cena pode trazer. HH responde bem a solo e água; HV, a vegetação. */
export type Polarization = "HH" | "HV";

/** Versão do produto do NISAR, conforme a coleção do catálogo da NASA que guarda a granule: beta, provisória ou validada. */
export type Release = "beta" | "provisional" | "validated";

/**
 * Uma fonte externa que documenta o evento de uma cena. `title` é escrito pelo time, no idioma pedido:
 * quem publicou, quando e o fato que a página confirma.
 */
export interface SceneSource {
  title: string;
  url: string;
}

/**
 * Tipo de imagem da cena. Ausente = "backscatter": o brilho do radar em cada passagem.
 * "interferogram": cada item de `acquisitions` é um par de passagens, e a imagem mostra a mudança de fase entre as
 * duas, em ciclos de cor. Não há brilho para comparar nem área alterada para medir.
 */
export type SceneKind = "backscatter" | "interferogram";

/** Uma passagem da série de uma cena. */
export interface SceneAcquisition {
  /** Data da passagem, AAAA-MM-DD. */
  date: string;
  /**
   * Uma imagem por polarização, já recortada para o `bbox` da cena (PNG ou JPG).
   * Chave ausente ou `null` faz o front desenhar um exemplo sintético para aquela polarização.
   */
  images: Partial<Record<Polarization, string | null>>;
  /** Granule do NISAR de onde saiu a imagem real desta passagem. Ausente na imagem de exemplo. */
  granule?: string;
  /** Versão do produto dessa granule. Uma cena pode comparar uma passagem provisória com uma validada. */
  release?: Release;
  /** Só em interferograma: data da primeira passagem do par. `date` é a da segunda, e a imagem vem em `images.HH`. */
  referenceDate?: string;
}

/**
 * Uma medida de água aberta nova numa passagem do NISAR: a parte do recorte que passou a devolver pouco sinal em
 * relação à referência de águas baixas da mesma órbita. Não é a área alagada toda: água sob árvores ou prédios não
 * aparece assim no radar.
 */
export interface WaterSample {
  /** Data da passagem, AAAA-MM-DD (UTC). */
  date: string;
  direction: Pass["direction"];
  track: number;
  /** Água aberta nova, em km², no limiar principal. */
  newWaterKm2: number;
  /** A mesma medida com o limiar de água mais exigente (`lowKm2`) e com o menos exigente (`highKm2`). */
  lowKm2?: number;
  highKm2?: number;
  /** `true` nas passagens que formam a referência de águas baixas: o valor delas é o piso de ruído da medida. */
  reference?: boolean;
}

/** Série de água aberta nova de uma cena de cheia, para o hidrograma. */
export interface WaterSeries {
  /** Como a medida foi feita, no idioma pedido, para a legenda do gráfico. */
  method: string;
  /**
   * Da passagem mais antiga para a mais recente, com as órbitas misturadas. Cada órbita vê o chão de um lado e
   * numa hora do dia: comparar valores só dentro da mesma órbita (`track`).
   */
  samples: WaterSample[];
}

/** Uma leitura do nível do rio, publicada por uma fonte que o time abriu e conferiu. */
export interface GaugeReading {
  /** Dia da leitura, AAAA-MM-DD, na hora local. */
  date: string;
  /** Hora local da leitura ("11:45"), se a fonte disser. */
  time?: string;
  /** Onde fica a régua, no idioma pedido, e onde isso fica em relação à imagem. */
  place: string;
  levelM: number;
  /** Se o rio subia ou descia na hora da leitura, quando a fonte diz. */
  trend?: "rising" | "falling";
  /** Nível a partir do qual o rio alaga casas nesse lugar, quando a mesma fonte diz. */
  floodLevelM?: number;
  source: SceneSource;
}

/** Uma cena analisada: um lugar, um evento e uma série de passagens para comparar. */
export interface Scene {
  id: string;
  name: string;
  /** Tipo de evento, já no idioma pedido: "Flood", "Deforestation"… */
  event: string;
  /** Onde fica, para leitura humana: "RS, Brazil". */
  region: string;
  lat: number;
  lon: number;
  /** Recorte geográfico das imagens: [oeste, sul, leste, norte], em graus. */
  bbox: [number, number, number, number];
  summary: string;
  /** O que acontece com o sinal na área alterada. Em interferograma não se aplica: ignorar. */
  change: "darker" | "brighter";
  /** Nota de 0 a 100 para cada `Criterion.id`. */
  scores: Record<string, number>;
  /** Linhas livres mostradas no detalhe e na comparação. Use os mesmos rótulos em todas as cenas. */
  facts: { label: string; value: string }[];
  /** Área alterada informada pela análise, em km². Opcional: com ela, o front mostra uma comparação de escala ("cerca de 4× Paris"). */
  areaKm2?: number;
  /** Polarizações disponíveis em todas as passagens. A primeira é a que abre. */
  polarizations: Polarization[];
  /**
   * Passagens da série, da mais antiga para a mais recente. Pelo menos duas, todas com o mesmo recorte.
   * O front compara a primeira com a última e deixa percorrer as do meio.
   */
  acquisitions: SceneAcquisition[];
  /**
   * De onde vêm as imagens reais. "preview": PNG de 8 bits do NISAR, contraste esticado em cada data (mudança relativa).
   * "gcov": recorte do arquivo GCOV calibrado, amplitude de gamma0 numa escala fixa igual nas duas datas.
   * "gunw": interferograma do produto GUNW, com a fase em ciclos de cor: branco na fase média da cena, escuro a
   * meio ciclo dela, transparente onde não há dado.
   * Ausente: imagem de exemplo ou origem não informada.
   */
  imagery?: "preview" | "gcov" | "gunw";
  /**
   * Em que a descrição da cena se apoia. "documented-event": `sources` documentam o evento; a leitura da imagem
   * continua sendo do time. "interpretation": sem evento confirmado, a cena é a nossa leitura do par de imagens.
   */
  basis?: "documented-event" | "interpretation";
  /** Fontes que documentam o evento. Só vem com `basis: "documented-event"`. */
  sources?: SceneSource[];
  /** Ressalva sobre a leitura da imagem, no idioma pedido: até duas frases, sem repetir o resumo. */
  caveat?: string;
  /**
   * Detalhes da imagem real, para quem quiser conferir. `topDb`: gamma0, em dB, que vira branco (cinza 255) em cada
   * polarização; só no dado calibrado. `validPct`: parte do recorte com dado nas duas datas, em %; o resto sai
   * preto na imagem, como água (no interferograma, transparente: é água ou onde o sinal se perdeu num dos dois pares).
   */
  imageryDetails?: { topDb?: Partial<Record<Polarization, number>>; validPct?: number };
  /** Tipo de imagem da cena. Ausente = "backscatter". `GET /scenes` só devolve as outras com `include=`. */
  kind?: SceneKind;
  /**
   * Só em interferograma: quantos centímetros de mudança na distância entre o chão e o satélite vale um ciclo de
   * cor (branco, escuro, branco). Sem ele, não falar em centímetros.
   */
  cycleCm?: number;
  /**
   * Só em cena de cheia com série medida: a água aberta nova em cada passagem do NISAR. É outra medida, não a do
   * mapa de mudança (que conta subida e queda do sinal): não somar nem comparar as duas.
   */
  waterSeries?: WaterSeries;
  /** Leituras do nível do rio em torno do evento, da mais antiga para a mais recente, cada uma com a fonte. */
  riverGauge?: GaugeReading[];
  /**
   * Só em cena de cheia: o que existe de independente do NISAR em volta do evento (chuva, vazão modelada, dias de
   * visão óptica, mapa de água de outro satélite). Acompanha `waterSeries` no gráfico; não é medida do time.
   */
  floodContext?: FloodContext;
  /**
   * O que um satélite óptico viu num dia do evento, para pôr em volta do radar (no Taquari, o dia da passagem do
   * NISAR: nuvem sobre o vale). A imagem acompanha a página, não vem por endereço: scripts/optical_day.py a grava em
   * apps/web/src/assets/optical/<id da cena>-<date>.webp. Sem a imagem, o front não oferece a comparação.
   */
  opticalDay?: OpticalDay;
}

/** Uma imagem óptica diária sobre a região de uma cena. É para ver: não mede cobertura de nuvem. */
export interface OpticalDay {
  /** Dia da imagem, AAAA-MM-DD. */
  date: string;
  /** Região que a imagem cobre, bem maior que a cena: [oeste, sul, leste, norte], em graus. */
  bbox: [number, number, number, number];
  /** Satélite e instrumento, para a legenda: "MODIS Aqua". */
  sensor: string;
  /** Crédito da imagem: "NASA GIBS · MODIS Aqua". */
  credit: string;
  /** O que a imagem mostra, no idioma pedido, em uma frase. */
  caption: string;
}

/**
 * CONTEXTO DE UMA CHEIA, de fontes públicas que não são o NISAR, para conferir a série de água (`waterSeries`).
 * As séries diárias (`rainMm`, `dischargeM3s`) começam em `start`, um valor por dia; `null` é dia sem dado.
 * Gerado por scripts/hydrograph.py.
 */
export interface FloodContext {
  /** Primeiro e último dia das séries diárias, AAAA-MM-DD. */
  start: string;
  end: string;
  /** Chuva média na bacia, mm por dia (reanálise ERA5). */
  rainMm: (number | null)[];
  /** Vazão modelada (GloFAS), m³/s por dia. É modelo, não medição. */
  dischargeM3s: (number | null)[];
  /** Dias em que um satélite óptico (HLS: Landsat e Sentinel-2) cobriu o recorte, e quanto dele era nuvem. */
  optical: { date: string; cloudPct: number }[];
  /**
   * Água aberta no mapa OPERA DSWx-S1 (Sentinel-1, banda C): outro satélite, outro método. É toda a água aberta
   * do recorte, com o leito normal do rio: não é a mesma medida de `waterSeries` (só a água nova).
   */
  independent: { date: string; waterKm2: number }[];
  /** Datas dos mapas independentes que acompanham a página. */
  maps: { opera: string[]; hls: string[] };
}

/**
 * GET /scenes?lang=&include=
 * Sem `include`, só cenas de brilho ("backscatter"). `include=interferogram` acrescenta as de interferograma,
 * para o front que já sabe mostrá-las.
 */
export interface ScenesResponse {
  criteria: Criterion[];
  scenes: Scene[];
}

/** Uma passagem do NISAR sobre um ponto. GET /passes?lat=&lon= devolve `Pass[]`, da mais recente para a mais antiga. */
export interface Pass {
  /** AAAA-MM-DD */
  date: string;
  direction: "ascending" | "descending";
  track: number;
  frame: number;
  /** "HH", "HH + HV"… */
  polarization: string;
  /** "GCOV", "GSLC"… */
  product: string;
  /** `true` quando a passagem foi inventada (catálogo da NASA fora do ar ou desligado). O front avisa o usuário. */
  isExample?: boolean;
}

/** Idiomas da interface. Toda rota que devolve texto aceita `lang`; sem ele, responde em inglês. */
export type Lang = "en" | "pt";

export type PlaceKind = "city" | "state" | "country";

/**
 * Um lugar encontrado na busca. GET /places?q=&kind=&lang=&country=&admin= devolve `Place[]`.
 * `country` (código do país) e `admin` (o `adminKey` de um estado) restringem a busca a esse país ou estado;
 * com um deles, `q` pode vir vazio para listar o que há dentro.
 */
export interface Place {
  kind: PlaceKind;
  name: string;
  /** Estado ou província, quando houver. */
  admin?: string;
  country?: string;
  /** Código ISO de duas letras do país: "BR". Serve para filtrar estados e cidades dentro dele. */
  countryCode?: string;
  /** Identificador do estado, igual nos dois idiomas. Num estado é o dele; numa cidade, o do estado onde ela fica. */
  adminKey?: string;
  lat: number;
  lon: number;
  /** Tamanho aproximado do lugar, em graus. O mapa usa para escolher a ampliação de países e estados. */
  spanDeg?: number;
}

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

/** POST /ask e POST /ask/stream */
export interface AskRequest {
  question: string;
  /** Cenas em contexto: a que está aberta e as marcadas para comparar. O agente responde sobre elas. */
  sceneIds: string[];
  /** Conversa até aqui, da mais antiga para a mais nova, sem a pergunta atual. */
  history?: ChatMessage[];
  lang?: Lang;
}

/**
 * De onde saiu a resposta do agente:
 * - `model`: escrita pelo modelo, só com os cartões de fatos, e aprovada pelo verificador do agente;
 * - `offline`: frases dos próprios cartões de fatos, sem modelo (sem chave, sem cota, modelo lento ou resposta reprovada);
 * - `no_info`: a pergunta está fora do que o agente sabe.
 */
export type AskMode = "model" | "offline" | "no_info";

export interface AskResponse {
  answer: string;
  /** Cenas citadas na resposta. O front transforma cada uma num botão que leva ao mapa. */
  citations: { sceneId: string }[];
  /** Ressalvas dos fatos usados na resposta, no idioma pedido. Quem as cola é o agente, não o modelo. */
  caveats?: string[];
  /** Fontes dos fatos usados na resposta. Quem as cola é o agente, não o modelo. */
  sources?: SceneSource[];
  /** Só com o agente ligado: de onde saiu a resposta. */
  mode?: AskMode;
  /** `true` quando o agente não está ligado e a resposta é o texto de exemplo, calculado das notas. O front avisa. */
  isExample?: boolean;
}

/**
 * Eventos de POST /ask/stream (text/event-stream). Cada evento é uma linha `data: <JSON>`.
 * A resposta chega em pedaços `delta`; o último evento é `done`, com a resposta completa, ou `error`.
 */
export type AskStreamEvent =
  | { type: "delta"; text: string }
  | { type: "done"; response: AskResponse }
  | { type: "error"; message: string };
