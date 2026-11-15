import { BadRequestException, Body, Controller, Get, HttpCode, HttpException, Post, Query, Req, Res } from "@nestjs/common";
import type { Request, Response } from "express";
import type { AskRequest, AskResponse, AskStreamEvent, Lang, Pass, Place, PlaceKind, ScenesResponse } from "@nexxus/contract";
import { AgentBusyError, AgentService } from "./agent.service";
import { PassesService } from "./passes.service";
import { parseInclude, servedScenes } from "./scene-images";
import { PlacesService } from "./places.service";

/**
 * API DE EXEMPLO. Cada rota devolve o formato de packages/contract/src/types.ts.
 * A API de verdade precisa responder nas mesmas rotas, com os mesmos formatos.
 */

/**
 * Um parâmetro da query como texto. O Express entrega uma lista quando o parâmetro vem repetido (`?q=a&q=b`) e um
 * objeto quando vem com colchetes (`?q[x]=1`): vale o primeiro texto da lista, e o resto conta como ausente. Sem isto,
 * `.trim()` numa lista derrubava a rota com 500.
 */
const text = (raw: unknown): string | undefined =>
  typeof raw === "string" ? raw : Array.isArray(raw) && typeof raw[0] === "string" ? raw[0] : undefined;

const lang = (raw?: unknown): Lang => (text(raw) === "pt" ? "pt" : "en");

@Controller("health")
export class HealthController {
  constructor(private readonly agent: AgentService, private readonly passes: PassesService) {}

  @Get()
  health() {
    return { ok: true, data: "example", passes: this.passes.source, agent: this.agent.connected ? "connected" : "example" };
  }
}

@Controller("scenes")
export class ScenesController {
  /**
   * Cenas de exemplo; as que têm imagem real (scripts/gcov_crop.py) ganham as imagens por polarização, as datas, o
   * bbox, a granule e a versão de cada passagem. Ver `servedScenes`. `include=interferogram` acrescenta a cena
   * de interferograma, que o front só deve pedir quando souber mostrá-la.
   */
  @Get()
  list(@Query("lang") l?: unknown, @Query("include") include?: unknown): ScenesResponse {
    return servedScenes(lang(l), parseInclude(include));
  }
}

@Controller("passes")
export class PassesController {
  constructor(private readonly passes: PassesService) {}

  /** Passagens reais do catálogo da NASA (CMR). Se ele falhar, exemplo marcado com `isExample`. */
  @Get()
  list(@Query("lat") latQuery?: unknown, @Query("lon") lonQuery?: unknown): Promise<Pass[]> {
    const latRaw = text(latQuery), lonRaw = text(lonQuery);
    const lat = Number(latRaw);
    const lon = Number(lonRaw);
    if (!latRaw?.trim() || !lonRaw?.trim() || !Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) {
      throw new BadRequestException("Send lat (-90 to 90) and lon (-180 to 180).");
    }
    return this.passes.list(lat, lon);
  }
}

@Controller("places")
export class PlacesController {
  constructor(private readonly places: PlacesService) {}

  @Get()
  search(
    @Query("q") q?: unknown, @Query("kind") kindQuery?: unknown, @Query("lang") l?: unknown,
    @Query("country") countryQuery?: unknown, @Query("admin") adminQuery?: unknown,
  ): Promise<Place[]> {
    const kind = text(kindQuery), country = text(countryQuery), admin = text(adminQuery);
    const k: PlaceKind | "all" = kind === "city" || kind === "state" || kind === "country" ? kind : "all";
    const countryCode = country && /^[A-Za-z]{2}$/.test(country) ? country.toUpperCase() : undefined;
    return this.places.search(text(q) ?? "", { kind: k, lang: lang(l), countryCode, adminKey: countryCode && admin ? admin : undefined });
  }
}

function parseAsk(body: AskRequest): AskRequest {
  if (!body || typeof body.question !== "string" || !body.question.trim()) {
    throw new BadRequestException("Send the question in `question`.");
  }
  return {
    question: body.question.trim(),
    sceneIds: Array.isArray(body.sceneIds) ? body.sceneIds.filter((x) => typeof x === "string") : [],
    history: Array.isArray(body.history)
      ? body.history.filter((m) => m && (m.role === "user" || m.role === "assistant") && typeof m.content === "string").slice(-20)
      : [],
    lang: lang(body.lang),
  };
}

/** O visitante de verdade: o primeiro endereço que o nginx (ou outro proxy) pôs em X-Forwarded-For, ou o da conexão. */
function clientIp(req: Request): string | undefined {
  const forwarded = req.headers["x-forwarded-for"];
  const first = (Array.isArray(forwarded) ? forwarded[0] : forwarded)?.split(",")[0].trim();
  return first || req.socket.remoteAddress || undefined;
}

@Controller("ask")
export class AskController {
  constructor(private readonly agent: AgentService) {}

  /** Resposta inteira de uma vez. */
  @Post()
  @HttpCode(200)
  async ask(@Body() body: AskRequest, @Req() request: Request): Promise<AskResponse> {
    try {
      return await this.agent.ask(parseAsk(body), clientIp(request));
    } catch (e) {
      if (e instanceof AgentBusyError) throw new HttpException(e.message, 429);
      throw e;
    }
  }

  /** Resposta em pedaços, por Server-Sent Events. O front usa esta rota e cai para POST /ask se ela não existir. */
  @Post("stream")
  @HttpCode(200)
  async stream(@Body() body: AskRequest, @Req() request: Request, @Res() res: Response): Promise<void> {
    const req = parseAsk(body);
    res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("X-Accel-Buffering", "no");
    res.flushHeaders();
    const send = (event: AskStreamEvent) => res.write(`data: ${JSON.stringify(event)}\n\n`);
    let closed = false;
    res.on("close", () => { closed = true; });
    try {
      for await (const event of this.agent.stream(req, clientIp(request))) {
        if (closed) return;
        send(event);
      }
    } catch (e) {
      send({ type: "error", message: e instanceof Error ? e.message : "Agent failed." });
    }
    res.end();
  }
}
