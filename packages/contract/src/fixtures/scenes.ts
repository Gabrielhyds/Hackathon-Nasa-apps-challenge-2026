import type { Criterion, FloodContext, GaugeReading, Lang, Polarization, Scene, SceneKind, ScenesResponse, WaterSample, WaterSeries } from "../types";
import taquariContext from "./taquari-context.json";
import water from "./taquari-water.json";

/**
 * DADOS DE EXEMPLO. Lugares, órbitas e datas reais: são os do manifest de apps/api/scene-images, gerado por
 * scripts/gcov_crop.py (mudou lá, mude aqui; um teste da API confere). Duas cenas de brilho têm evento confirmado,
 * com fonte: a enchente do Taquari de 22/07/2026 e a do Limpopo em Chókwè, de janeiro de 2026. As outras são descritas
 * como mudança sazonal, e o resumo diz o que o par de imagens calibradas mostra. `change` é o sentido da maior parte
 * da área que o mapa de mudança marca nesse par (HH, 1,25×); onde nada passa do limiar, o sinal da mediana da
 * diferença. Chókwè é a exceção: fica `darker`, o lado da cheia, embora o chão molhado em volta clareie numa área
 * bem maior (o resumo avisa); é esse campo que escolhe o lado da comparação de escala na tela. As notas são inventadas (`isExample` em cada critério); o Taquari fica em primeiro com os pesos iguais
 * (um teste do front conta com isso).
 * Fonte (`sources`) só entra se alguém do time abriu a página e leu nela o fato que o título diz; sem isso, a cena
 * não tem evento e sai como "interpretation". `caveat` é a ressalva de leitura da imagem: até duas frases, 280
 * caracteres, sem medida e sem repetir o resumo.
 * Sem a API (modo `mock` do front), as imagens ficam `null` e o front desenha o exemplo de cada polarização.
 * A série de água do Taquari (`waterSeries`) e as leituras do rio (`riverGauge`) são medidas e fontes reais nos
 * dois modos: ver `waterSeries`, abaixo.
 * A última cena, La Guaira, é um interferograma (`kind`): os terremotos de 24/06/2026 no norte da Venezuela, nas
 * imagens de scripts/gunw_crop.py. Só entra na lista a pedido (`include`), e a API só a serve com as imagens: não há
 * exemplo que substitua uma imagem de fase. No resumo dela, nada de contagem de faixas, de centímetros ou de sentido
 * do movimento: quantos centímetros vale um ciclo de cor vem do manifest (`cycleCm`). O resumo e a ressalva descrevem
 * as imagens como o script as grava hoje (ionosfera descontada, branco na fase média da cena): mudou o método, releia.
 */
type Text = Record<Lang, string>;
const t = (en: string, pt: string): Text => ({ en, pt });

const CRITERIA_TEXT: { id: string; label: Text }[] = [
  { id: "magnitude", label: t("Size of the change", "Tamanho da mudança") },
  { id: "area", label: t("Area affected", "Área afetada") },
  { id: "clarity", label: t("Clean signal", "Sinal limpo") },
  { id: "passes", label: t("Passes available", "Passagens disponíveis") },
];
const FACT_LABELS = [
  t("Season", "Estação"), t("Orbit", "Órbita"), t("Passes on this orbit since June", "Passagens nesta órbita desde junho"),
  t("Polarization", "Polarização"),
];
const SEASONAL = t("Seasonal change", "Mudança sazonal");
const EVENT_LABEL = t("Event", "Evento");

/**
 * Fonte de um evento. `title` é nosso: quem publicou, quando e o fato do resumo que a página confirma.
 * `checked` é o dia em que a página foi aberta e conferida; não vai na resposta.
 */
interface Src { title: Text; url: string; checked: string }

/** Leitura do nível do rio, com a fonte em que foi lida. `place` diz também onde isso fica em relação à imagem. */
interface Gauge {
  date: string; time?: string; place: Text; levelM: number; trend?: GaugeReading["trend"]; floodLevelM?: number; source: Src;
}

/** Leituras da plataforma estadual ClimaRS no fim da manhã de 23/07/2026, como o Brasil de Fato as publicou. */
const CLIMARS_JULY_23: Src = {
  title: t("Brasil de Fato, July 23, 2026: at 11:45 the Taquari River stood at 23.10 m in Estrela, falling, and at 9.10 m in the town of Taquari, farther downstream, still rising (readings from the state's ClimaRS platform)",
    "Brasil de Fato, 23/07/2026: às 11h45 o rio Taquari marcava 23,10 m em Estrela, em queda, e 9,10 m no município de Taquari, mais abaixo, ainda subindo (leituras da plataforma estadual ClimaRS)"),
  url: "https://www.brasildefato.com.br/2026/07/23/chuvas-obrigam-11-mil-pessoas-a-deixar-suas-casas-no-rs-danos-atingem-194-cidades/",
  checked: "2026-11-14",
};

interface Raw {
  id: string; name: Text; region: Text; lat: number; lon: number;
  scores: [number, number, number, number];
  /** Recorte das imagens, [oeste, sul, leste, norte] */
  bbox: [number, number, number, number];
  /** STACK_ID do NISAR: trilha, direção e quadro ("053_D_103") */
  stack: string;
  /** [estação, passagens da órbita desde junho de 2026, polarização] */
  facts: [Text, number, string];
  /** Evento confirmado, com fonte: troca "Mudança sazonal" pelo nome e a estação pela data */
  event?: { name: Text; when: Text; sources?: [Src, ...Src[]] };
  /** Ressalva de leitura da imagem */
  caveat?: Text;
  /** Imagem óptica de um dia do evento (scripts/optical_day.py): data, recorte e o que ela mostra */
  optical?: { date: string; bbox: [number, number, number, number]; sensor: string; credit: string; caption: Text };
  /** Leituras do nível do rio em torno do evento, da mais antiga para a mais recente */
  gauge?: Gauge[];
  /** Ausente = brilho do radar. "interferogram": `dates` são as segundas passagens de dois pares */
  kind?: SceneKind;
  /** Só em interferograma: a primeira passagem de cada par, na ordem de `dates` */
  referenceDates?: [string, string];
  /** Datas das duas passagens comparadas, a mais antiga primeiro */
  change: Scene["change"]; dates: [string, string]; summary: Text;
}

/** Contexto independente das cheias (chuva, vazão modelada, óptico, OPERA), por cena. Gerado por scripts/hydrograph.py. */
const FLOOD_CONTEXT: Record<string, FloodContext> = { taquari: taquariContext as FloodContext };

const RAW: Raw[] = [
  { id: "taquari", name: t("Lower Taquari Valley", "Baixo Vale do Taquari"), region: t("RS, Brazil", "RS, Brasil"),
    lat: -29.726, lon: -51.812, scores: [92, 80, 78, 70], bbox: [-51.94336, -29.84064, -51.67969, -29.61167], stack: "053_D_103",
    facts: [t("Winter", "Inverno"), 11, "HH + HV"],
    event: { name: t("Flood", "Enchente"), when: t("River flood, July 22, 2026", "Cheia do rio, 22/07/2026"),
      sources: [
        { title: t("Jornal do Comércio, October 6, 2026: the Taquari River reached 24.7 m in Lajeado on July 22",
            "Jornal do Comércio, 06/10/2026: o rio Taquari chegou a 24,7 m em Lajeado em 22 de julho"),
          url: "https://www.jornaldocomercio.com/jornal-cidades/2026/10/1265366-prefeitura-de-lajeado-monitora-uso-de-imoveis-em-areas-condenadas.html",
          checked: "2026-11-14" },
        { title: t("Jornal do Comércio, July 24, 2026: the first flood above the flood level since the floods of 2024",
            "Jornal do Comércio, 24/07/2026: a primeira cheia acima da cota de inundação desde as enchentes de 2024"),
          url: "https://www.jornaldocomercio.com/jornal-cidades/2026/07/1257468-leite-visita-vale-do-taquari-e-admite-falha-na-comunicacao-de-alertas.html",
          checked: "2026-11-14" },
      ] },
    caveat: t("Dark is not always floodwater: the river and smooth fields also return little signal, and parts of this scene were already dark on July 11. The flood is what turned dark between the two passes, not everything dark on July 23.",
      "Escuro nem sempre é água da cheia: o rio e o solo liso de lavoura também devolvem pouco sinal, e partes desta cena já estavam escuras em 11/07. A cheia é o que escureceu entre as duas passagens, não tudo o que está escuro em 23/07."),
    // o mesmo dia da passagem de radar (23/07, 21h33 UTC), horas antes; em 22/07 a região é um branco liso, que não se lê na tela
    optical: { date: "2026-07-23", bbox: [-54.3, -31.6, -49.3, -27.9], sensor: "MODIS Aqua", credit: "NASA GIBS · MODIS Aqua",
      caption: t("What a camera in orbit saw that day: cloud over the whole valley. The radar image inside the frame was made hours later, through it.",
        "O que uma câmera em órbita viu naquele dia: nuvem sobre o vale inteiro. A imagem de radar dentro da moldura foi feita horas depois, através dela.") },
    // Lajeado e Estrela ficam 16 e 12 km ao norte do recorte; a cidade de Taquari, dentro dele
    gauge: [
      { date: "2026-07-22", place: t("Lajeado, upstream of the image", "Lajeado, rio acima da imagem"), levelM: 24.7, floodLevelM: 19,
        source: {
          title: t("Jornal do Comércio, October 6, 2026: the river reached 24.7 m on July 22; in Lajeado, homes start to flood at the 19 m mark, according to the mayor",
            "Jornal do Comércio, 06/10/2026: o rio chegou a 24,7 m em 22 de julho; em Lajeado, as casas começam a alagar na cota 19, segundo a prefeita"),
          url: "https://www.jornaldocomercio.com/jornal-cidades/2026/10/1265366-prefeitura-de-lajeado-monitora-uso-de-imoveis-em-areas-condenadas.html",
          checked: "2026-11-14" } },
      { date: "2026-07-23", time: "11:45", place: t("Estrela, upstream of the image", "Estrela, rio acima da imagem"), levelM: 23.1,
        trend: "falling", source: CLIMARS_JULY_23 },
      { date: "2026-07-23", time: "11:45", place: t("Taquari, the town inside the image", "Taquari, a cidade dentro da imagem"), levelM: 9.1,
        trend: "rising", source: CLIMARS_JULY_23 },
    ],
    change: "darker", dates: ["2026-07-11", "2026-07-23"],
    summary: t("On July 22, 2026, the Taquari River reached 24.7 m in Lajeado, its first flood above the flood level since 2024. NISAR passed over the lower valley the next evening, while clouds still hid much of it from optical satellites. Still water returns almost no signal, so the flooded land along the river turns dark.",
      "Em 22 de julho de 2026, o rio Taquari chegou a 24,7 m em Lajeado, a primeira cheia acima da cota de inundação desde 2024. O NISAR passou sobre o baixo vale na noite seguinte, quando as nuvens ainda escondiam boa parte dele dos satélites ópticos. Água parada quase não devolve sinal, então a terra alagada ao longo do rio fica escura.") },
  { id: "chokwe", name: t("Chókwè, Limpopo River", "Chókwè, rio Limpopo"), region: t("Mozambique", "Moçambique"),
    lat: -24.53, lon: 33.0, scores: [84, 95, 96, 38], bbox: [32.67, -24.83, 33.33, -24.23], stack: "114_A_165",
    facts: [t("Rainy season", "Estação das chuvas"), 9, "HH + HV"],
    event: { name: t("Flood", "Enchente"), when: t("River flood, January 2026", "Cheia do rio, janeiro de 2026"),
      sources: [
        { title: t("NASA Scientific Visualization Studio, August 6, 2026: NISAR images from January 5 and 17, 2026, show the flood along the Limpopo and Incomati rivers, Chókwè included",
            "NASA Scientific Visualization Studio, 06/08/2026: imagens do NISAR de 5 e 17 de janeiro de 2026 mostram a cheia nos rios Limpopo e Incomati, Chókwè incluída"),
          url: "https://svs.gsfc.nasa.gov/5661", checked: "2026-11-14" },
      ] },
    change: "darker", dates: ["2026-01-05", "2026-01-17"],
    summary: t("In January 2026, after intense seasonal rain, the Limpopo River flooded the plain around Chókwè, in southern Mozambique (NASA). NISAR passed over on January 5, before the flood, and on January 17, during it. In the second pass a dark band several kilometers wide follows the river: still water returns almost no signal. The ground around it turns brighter, as wet soil does, so the change map also marks land that was not flooded.",
      "Em janeiro de 2026, depois de chuvas sazonais intensas, o rio Limpopo alagou a planície em volta de Chókwè, no sul de Moçambique (NASA). O NISAR passou em 5 de janeiro, antes da cheia, e em 17 de janeiro, durante ela. Na segunda passagem, uma faixa escura com vários quilômetros de largura acompanha o rio: água parada quase não devolve sinal. O chão em volta clareia, como acontece com solo molhado, então o mapa de mudança também marca terra que não alagou.") },
  { id: "sindh", name: t("Sindh", "Sindh"), region: t("Pakistan", "Paquistão"),
    lat: 26.0, lon: 68.5, scores: [88, 95, 66, 58], bbox: [68.1, 25.6, 68.9, 26.4], stack: "041_A_015",
    facts: [t("Before → end of the monsoon", "Antes → fim das monções"), 11, "HH + HV"],
    change: "brighter", dates: ["2026-06-17", "2026-09-09"],
    summary: t("From before the monsoon to its end. Across the irrigated plain east of the Indus, fields turn brighter: growing crops and wetter soil both return more signal. Along the river, the dark band of water is wider in the second pass.",
      "De antes das monções até o fim delas. Na planície irrigada a leste do Indo, as lavouras clareiam: plantas crescendo e solo mais úmido devolvem mais sinal. Ao longo do rio, a faixa escura de água está mais larga na segunda passagem.") },
  { id: "labrea", name: t("Lábrea", "Lábrea"), region: t("AM, Brazil", "AM, Brasil"),
    lat: -7.3, lon: -64.8, scores: [78, 62, 84, 86], bbox: [-65.25, -7.75, -64.35, -6.85], stack: "161_A_174",
    facts: [t("Dry season → first rains", "Seca → primeiras chuvas"), 9, "HH + HV"],
    change: "brighter", dates: ["2026-08-24", "2026-10-23"],
    summary: t("From the dry season to the first rains. The forest returns a steady signal; what changes is the moisture of pastures, open areas and riverbanks. Overall, the brightness barely changes.",
      "Da seca às primeiras chuvas. A floresta devolve um sinal estável; o que muda é a umidade de pastos, áreas abertas e margens de rio. No conjunto, o brilho quase não muda.") },
  { id: "jakobshavn", name: t("Jakobshavn", "Jakobshavn"), region: t("Greenland", "Groenlândia"),
    lat: 69.2, lon: -49.8, scores: [74, 52, 80, 82], bbox: [-50.3, 68.7, -49.3, 69.7], stack: "131_A_037",
    facts: [t("Summer → early winter", "Verão → começo do inverno"), 11, "HH"],
    change: "brighter", dates: ["2026-06-23", "2026-11-02"],
    summary: t("From summer to the start of winter. Snow, ice and frozen ground change with temperature. In this pair the trunk of the glacier, from the middle of the scene to the east, turns clearly brighter, while parts of the ice sheet to the north and of the land to the west turn darker.",
      "Do verão ao começo do inverno. Neve, gelo e chão congelado mudam com a temperatura. Neste par, o tronco da geleira, do meio da cena para o leste, clareia bastante, enquanto partes do manto de gelo ao norte e da terra a oeste escurecem.") },
  { id: "pantanal", name: t("Pantanal", "Pantanal"), region: t("MS, Brazil", "MS, Brasil"),
    lat: -18.5, lon: -57.2, scores: [66, 88, 60, 74], bbox: [-57.7, -19.0, -56.7, -18.0], stack: "132_A_168",
    facts: [t("Middle → end of the dry season", "Meio → fim da seca"), 9, "HH + HV"],
    change: "brighter", dates: ["2026-07-17", "2026-10-21"],
    summary: t("From the middle to the end of the dry season. Still water looks dark to the radar; as lakes and flooded fields shrink, land takes their place and the scene brightens.",
      "Do meio ao fim da seca. Água parada aparece escura no radar; quando lagoas e campos alagados encolhem, a terra ocupa o lugar e a cena clareia.") },
  { id: "kalimantan", name: t("Kalimantan", "Kalimantan"), region: t("Indonesia", "Indonésia"),
    lat: -0.5, lon: 113.5, scores: [70, 58, 72, 64], bbox: [113.1, -0.9, 113.9, -0.1], stack: "061_D_089",
    facts: [t("Dry season → first rains", "Seca → primeiras chuvas"), 6, "HH + HV"],
    change: "darker", dates: ["2026-06-30", "2026-10-28"],
    summary: t("From the dry season to the first rains, under cloud that rarely clears. Forest, peat and plantations; overall, the brightness barely changes.",
      "Da seca às primeiras chuvas, sob nuvem que quase nunca abre. Floresta, turfa e plantações; no conjunto, o brilho quase não muda.") },
  { id: "gelo-sul", name: t("Southern Patagonian Ice Field", "Campo de Gelo Sul"), region: t("Patagonia", "Patagônia"),
    lat: -49.3, lon: -73.2, scores: [58, 40, 70, 52], bbox: [-73.7, -49.8, -72.7, -48.8], stack: "032_A_153",
    facts: [t("Winter → spring", "Inverno → primavera"), 10, "HH + HV"],
    change: "darker", dates: ["2026-06-28", "2026-10-26"],
    summary: t("From winter to spring. Wet snow returns less signal than dry snow, a common reason for ice to darken as it warms; in this pair, large parts of the scene turn darker.",
      "Do inverno à primavera. Neve úmida devolve menos sinal que neve seca, motivo comum para o gelo escurecer quando esquenta; neste par, boa parte da cena escurece.") },
  { id: "campinas", name: t("Campinas", "Campinas"), region: t("SP, Brazil", "SP, Brasil"),
    lat: -23.0, lon: -47.1, scores: [62, 46, 76, 88], bbox: [-47.6, -23.5, -46.6, -22.5], stack: "024_D_100",
    facts: [t("Dry winter → first rains", "Inverno seco → primeiras chuvas"), 11, "HH + HV"],
    change: "darker", dates: ["2026-06-27", "2026-11-06"],
    summary: t("Home of our team. The city is the bright patch: walls and roofs bounce the radar straight back. Around it, fields change with the crop cycle and soil moisture; overall, the brightness barely changes.",
      "A cidade do nosso time. A mancha clara é a cidade: paredes e telhados devolvem o radar direto ao satélite. Em volta, as lavouras mudam com o ciclo das culturas e a umidade do solo; no conjunto, o brilho quase não muda.") },
  { id: "maceio", name: t("Maceió", "Maceió"), region: t("AL, Brazil", "AL, Brasil"),
    lat: -9.6, lon: -35.7, scores: [44, 18, 82, 90], bbox: [-36.05, -9.95, -35.35, -9.25], stack: "139_D_093",
    facts: [t("Rainy season → dry season", "Chuvas → seca"), 10, "HH + HV"],
    change: "darker", dates: ["2026-06-23", "2026-10-21"],
    caveat: t("Over the sea the signal is very weak, and what shows up there at high sensitivity is wind and noise, not change on the ground.",
      "Sobre o mar o sinal é muito fraco, e o que aparece ali com a sensibilidade alta é vento e ruído, não mudança no chão."),
    summary: t("From the rainy season to the dry season. The land turns darker: drier soil returns less signal, and patches the shape of farm fields darken, most clearly in HV.",
      "Das chuvas à seca. A terra escurece: solo mais seco devolve menos sinal, e manchas com forma de lavoura escurecem, mais nítidas em HV.") },
  // Interferograma: só entra em GET /scenes?include=interferogram. `dates` são as segundas passagens dos dois pares
  // (o primeiro termina antes dos terremotos, o segundo os atravessa); `change` não se aplica.
  { id: "laguaira", name: t("La Guaira and Caracas", "La Guaira e Caracas"), region: t("Venezuela", "Venezuela"),
    lat: 10.55, lon: -66.93, scores: [90, 55, 76, 69], bbox: [-67.1, 10.25, -66.5, 10.7], stack: "061_A_007",
    facts: [t("Rainy season", "Estação das chuvas"), 12, "HH"],
    kind: "interferogram", referenceDates: ["2026-06-06", "2026-06-18"],
    event: { name: t("Earthquake", "Terremoto"), when: t("Earthquakes, June 24, 2026", "Terremotos, 24/06/2026"),
      sources: [
        { title: t("NASA Earth Observatory, July 10, 2026: a magnitude 7.2 earthquake and, less than a minute later, a magnitude 7.5 one struck northern Venezuela on June 24, 2026; NISAR's ground displacement map shows the motion was especially intense near Caracas and La Guaira",
            "NASA Earth Observatory, 10/07/2026: um terremoto de magnitude 7,2 e, menos de um minuto depois, outro de magnitude 7,5 atingiram o norte da Venezuela em 24 de junho de 2026; o mapa de deslocamento do NISAR mostra movimento mais intenso perto de Caracas e La Guaira"),
          url: "https://science.nasa.gov/earth/earth-observatory/where-venezuelas-earthquakes-shifted-the-ground/",
          checked: "2026-11-14" },
      ] },
    caveat: t("Not every band or patch is ground motion: the dark patch in the southeast is in both pairs, so it comes from the June 18 pass they share, not from the earthquakes. And the color gives only the change along the radar's line of sight, not which way the ground moved.",
      "Nem toda faixa ou mancha é movimento do chão: a mancha escura do sudeste está nos dois pares, então vem da passagem de 18/06, comum aos dois, e não dos terremotos. E a cor só dá a mudança na direção em que o radar olha, não para que lado o chão andou."),
    change: "brighter", dates: ["2026-06-18", "2026-06-30"],
    summary: t("On June 24, 2026, a magnitude 7.2 earthquake and, less than a minute later, a magnitude 7.5 one struck northern Venezuela; NASA's map of ground displacement, made with NISAR, shows the motion was especially intense near Caracas and La Guaira. These are not brightness images: each one compares two NISAR passes, and the color shows how much the distance between the ground and the satellite changed between them, relative to the scene average. It goes from white to dark and back to white as that difference grows. In the pair from before the earthquakes, most of the scene stays close to white, with darker patches but no bands. In the pair that spans them, broad bands cross most of the scene and crowd together near the coast, around La Guaira. The gaps are the sea and a large part of the land, where the signal was lost in one of the two pairs.",
      "Em 24 de junho de 2026, um terremoto de magnitude 7,2 e, menos de um minuto depois, outro de magnitude 7,5 atingiram o norte da Venezuela; o mapa de deslocamento do chão que a NASA fez com o NISAR mostra movimento mais intenso perto de Caracas e La Guaira. Estas não são imagens de brilho: cada uma compara duas passagens do NISAR, e a cor mostra quanto a distância entre o chão e o satélite mudou entre elas, em comparação com a média da cena: vai do branco ao escuro e volta ao branco conforme essa diferença cresce. No par anterior aos terremotos, a maior parte da cena fica perto do branco, com manchas mais escuras, mas sem faixas. No par que os atravessa, faixas largas cruzam quase toda a cena e se apertam perto da costa, em volta de La Guaira. Os vazios são o mar e boa parte da terra, onde o sinal se perdeu em um dos dois pares.") },
];

/** "053_D_103" → "Track 53, descending" */
function orbit(stack: string, lang: Lang): string {
  const [track, dir] = stack.split("_");
  const n = Number(track);
  const asc = dir === "A";
  return lang === "pt" ? `Trilha ${n}, ${asc ? "ascendente" : "descendente"}` : `Track ${n}, ${asc ? "ascending" : "descending"}`;
}

/**
 * Água aberta nova do Taquari em cada passagem, medida por scripts/water_series.py nas duas órbitas que cobrem o
 * recorte. O JSON guarda as 21 passagens, os parâmetros e as que ficaram de fora. À cena só vão as passagens até
 * WATER_UNTIL: a referência de águas baixas, a cheia de 22/07 e a passagem de quatro dias depois, já perto do piso.
 * Daí em diante a medida sobe aos poucos e não volta ao piso, com ou sem cheia na data (lavoura preparada para o
 * plantio também devolve pouco sinal): mostrá-la como água da cheia enganaria.
 * O texto de `WATER_METHOD` cita os parâmetros do JSON; um teste da API confere um contra o outro.
 */
const WATER_UNTIL = "2026-07-27";
const WATER_METHOD = t(
  "New open water relative to the same orbit's low-water reference (the median of its passes up to July 21, 2026): where the reference was land (HH at −14 dB or more), HH fell 3 dB or more, to below −12 dB (range: −14 to −10 dB). Patches under 1 ha and water under trees or buildings are not counted. Descending passes are at about 18:30 local time, ascending ones at about 06:20: compare within an orbit.",
  "Água aberta nova em relação à referência de águas baixas da mesma órbita (a mediana das passagens dela até 21/07/2026): onde a referência era terra (HH de −14 dB para cima), o HH caiu 3 dB ou mais e ficou abaixo de −12 dB (faixa: −14 a −10 dB). Manchas com menos de 1 ha e água sob árvores ou prédios não entram. As passagens descendentes são por volta das 18h30, hora local, e as ascendentes por volta das 6h20: compare dentro da mesma órbita.");

function waterSeries(r: Raw, lang: Lang): WaterSeries | undefined {
  // a série vale para o recorte em que foi medida: mudou o bbox da cena, ela some até o script rodar de novo
  if (water.scene !== r.id || water.bbox.length !== 4 || water.bbox.some((v, i) => v !== r.bbox[i])) return undefined;
  const samples = water.passes.filter((p) => p.date <= WATER_UNTIL).map((p): WaterSample => ({
    date: p.date, direction: p.direction === "ascending" ? "ascending" : "descending", track: p.track,
    newWaterKm2: p.newWaterKm2, lowKm2: p.lowKm2, highKm2: p.highKm2,
    ...(p.reference ? { reference: true } : {}),
  }));
  return samples.length ? { method: WATER_METHOD[lang], samples } : undefined;
}

function riverGauge(r: Raw, lang: Lang): GaugeReading[] | undefined {
  return r.gauge?.map((g) => ({
    date: g.date, ...(g.time ? { time: g.time } : {}), place: g.place[lang], levelM: g.levelM,
    ...(g.trend ? { trend: g.trend } : {}), ...(g.floodLevelM !== undefined ? { floodLevelM: g.floodLevelM } : {}),
    source: { title: g.source.title[lang], url: g.source.url },
  }));
}

export function criteria(lang: Lang = "en"): Criterion[] {
  // as notas de todos os critérios são inventadas: quem mostra o ranking avisa
  return CRITERIA_TEXT.map((c) => ({ id: c.id, label: c.label[lang], isExample: true }));
}

/**
 * Cenas de exemplo. Sem `include`, só as de brilho: é o que o front de hoje sabe mostrar. As de interferograma
 * entram quando pedidas e ficam no fim da lista.
 */
export function scenes(lang: Lang = "en", include: readonly SceneKind[] = []): Scene[] {
  return RAW.filter((r) => !r.kind || r.kind === "backscatter" || include.includes(r.kind)).map((r) => {
    const polarizations: Polarization[] = r.facts[2].includes("HV") ? ["HH", "HV"] : ["HH"];
    const sources = r.event?.sources?.map((x) => ({ title: x.title[lang], url: x.url }));
    // sem evento, a cena é a nossa leitura do par; com evento, só é "documentado" se tiver fonte conferida
    const basis: Scene["basis"] = !r.event ? "interpretation" : sources ? "documented-event" : undefined;
    const series = waterSeries(r, lang);
    const gauge = riverGauge(r, lang);
    return {
      id: r.id, name: r.name[lang], event: (r.event?.name ?? SEASONAL)[lang], region: r.region[lang],
      lat: r.lat, lon: r.lon, summary: r.summary[lang], change: r.change,
      bbox: r.bbox,
      scores: Object.fromEntries(CRITERIA_TEXT.map((c, i) => [c.id, r.scores[i]])),
      facts: [
        r.event ? { label: EVENT_LABEL[lang], value: r.event.when[lang] } : { label: FACT_LABELS[0][lang], value: r.facts[0][lang] },
        { label: FACT_LABELS[1][lang], value: orbit(r.stack, lang) },
        { label: FACT_LABELS[2][lang], value: String(r.facts[1]) },
        { label: FACT_LABELS[3][lang], value: r.facts[2] },
      ],
      polarizations,
      // sem imagem: o front desenha o exemplo de cada polarização; a API troca pelas imagens reais
      acquisitions: r.dates.map((date, i) => ({
        date, images: Object.fromEntries(polarizations.map((p) => [p, null])),
        ...(r.referenceDates ? { referenceDate: r.referenceDates[i] } : {}),
      })),
      ...(r.kind ? { kind: r.kind } : {}),
      ...(basis ? { basis } : {}),
      ...(sources ? { sources } : {}),
      ...(r.caveat ? { caveat: r.caveat[lang] } : {}),
      ...(r.optical ? { opticalDay: { ...r.optical, caption: r.optical.caption[lang] } } : {}),
      ...(series ? { waterSeries: series } : {}),
      ...(gauge ? { riverGauge: gauge } : {}),
      // o contexto só acompanha a série: sem ela, não vai
      ...(series && FLOOD_CONTEXT[r.id] ? { floodContext: FLOOD_CONTEXT[r.id] } : {}),
    };
  });
}

export const scenesResponse = (lang: Lang = "en", include: readonly SceneKind[] = []): ScenesResponse =>
  ({ criteria: criteria(lang), scenes: scenes(lang, include) });
