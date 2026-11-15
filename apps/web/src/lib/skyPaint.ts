/**
 * Desenha o céu de lib/sky.ts num canvas atrás do globo: as estrelas e a Via Láctea.
 * Só é redesenhado quando a câmera muda: o movimento vem do giro do globo.
 */
import type { Map as GlMap } from "maplibre-gl";
import { cameraBasis, galacticToEquatorial, globeView, gmstDeg, projectSky, starColor, unit, type Vec3 } from "./sky";

interface Star { dir: Vec3; r: number; alpha: number; color: string; glow: boolean }
interface Cloud { dir: Vec3; size: number; alpha: number; warm: boolean }

/** Gerador com semente, para a névoa da Via Láctea sair igual em toda visita. */
function seeded(seed: number) {
  let s = seed;
  return () => { s = (s + 0x6D2B79F5) | 0; let t = Math.imul(s ^ (s >>> 15), 1 | s); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

/** Névoa ao longo do plano galáctico: mais larga e mais clara perto do centro, em Sagitário. É um desenho da faixa, não uma medida de brilho. */
function milkyWay(): Cloud[] {
  const rnd = seeded(1977), gauss = () => (rnd() + rnd() + rnd() + rnd() - 2) * 1.73, out: Cloud[] = [];
  for (let i = 0; i < 620; i++) {
    const core = rnd() < 0.42, l = core ? gauss() * 32 : rnd() * 360, near = Math.exp(-((((l + 540) % 360) - 180) ** 2) / (2 * 45 ** 2));
    const b = gauss() * (3.2 + 4.5 * near);
    const [ra, dec] = galacticToEquatorial(l, b);
    out.push({ dir: unit(ra, dec), size: (3 + rnd() * 5) * (1 + 0.6 * near), alpha: 0.034 + 0.05 * near + rnd() * 0.016, warm: core && Math.abs(b) < 6 });
  }
  return out;
}

function stars(flat: number[]): Star[] {
  const out: Star[] = [];
  for (let i = 0; i < flat.length; i += 4) {
    const mag = flat[i + 2] / 10, [r, g, b] = starColor(flat[i + 3] / 10);
    out.push({ dir: unit(flat[i] / 100, flat[i + 1] / 100), r: Math.max(0.5, 2.6 - 0.3 * mag), alpha: Math.max(0.3, Math.min(1, 1.25 - 0.14 * mag)), color: `${r}, ${g}, ${b}`, glow: mag < 1.6 });
  }
  return out;
}

/** Mancha redonda que some para a borda, desenhada uma vez e carimbada. */
function blob(rgb: string): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = c.height = 64;
  const ctx = c.getContext("2d");
  if (ctx) {
    const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
    g.addColorStop(0, `rgba(${rgb}, 1)`); g.addColorStop(0.45, `rgba(${rgb}, 0.38)`); g.addColorStop(1, `rgba(${rgb}, 0)`);
    ctx.fillStyle = g; ctx.fillRect(0, 0, 64, 64);
  }
  return c;
}

/** Liga o céu ao mapa. Devolve a função que o desliga. */
export function startSky(map: GlMap, back: HTMLCanvasElement): () => void {
  const bctx = back.getContext("2d");
  if (!bctx) return () => {};
  const clouds = milkyWay(), cool = blob("150, 176, 230"), warm = blob("236, 206, 170"), halo = blob("255, 255, 255");
  let catalog: Star[] = [], raf = 0, lastKey = "", stopped = false;
  import("../assets/sky/stars.json").then((m) => { if (!stopped) { catalog = stars(m.default); lastKey = ""; } }).catch(() => { /* sem o catálogo fica só a névoa */ });

  function size(canvas: HTMLCanvasElement, ctx: CanvasRenderingContext2D, w: number, h: number, dpr: number) {
    if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) { canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr); }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
  }

  function frame() {
    raf = requestAnimationFrame(frame);
    const box = map.getContainer(), w = box.clientWidth, h = box.clientHeight;
    if (!w || !h) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1), date = new Date(), gmst = gmstDeg(date);
    const c = map.getCenter(), zoom = map.getZoom(), mid = map.project(c), view = globeView(zoom, c.lat, h);
    // os eixos da câmera no céu: a longitude do centro do mapa, levada à ascensão reta pela rotação da Terra
    const basis = cameraBasis(c.lat, c.lng + gmst);
    const covered = view.limb > Math.hypot(Math.max(mid.x, w - mid.x), Math.max(mid.y, h - mid.y));

    // só quando a câmera muda (a Terra gira 1° a cada 4 minutos)
    const key = [w, h, dpr, c.lat.toFixed(3), (c.lng + gmst).toFixed(2), zoom.toFixed(3), mid.x.toFixed(1), mid.y.toFixed(1), catalog.length].join("|");
    if (key !== lastKey) {
      lastKey = key;
      size(back, bctx!, w, h, dpr);
      if (!covered) {
        bctx!.globalCompositeOperation = "lighter";
        const per = view.distance * Math.PI / 180;
        for (const cloud of clouds) {
          const p = projectSky(cloud.dir, basis, view.distance);
          if (!p) continue;
          const r = cloud.size * per, x = mid.x + p[0], y = mid.y + p[1];
          if (x < -r || x > w + r || y < -r || y > h + r) continue;
          bctx!.globalAlpha = cloud.alpha;
          bctx!.drawImage(cloud.warm ? warm : cool, x - r, y - r, 2 * r, 2 * r);
        }
        for (const star of catalog) {
          const p = projectSky(star.dir, basis, view.distance);
          if (!p || Math.hypot(p[0], p[1]) < view.limb - 2) continue;
          const x = mid.x + p[0], y = mid.y + p[1];
          if (x < -8 || x > w + 8 || y < -8 || y > h + 8) continue;
          if (star.glow) { bctx!.globalAlpha = 0.2; bctx!.drawImage(halo, x - star.r * 5, y - star.r * 5, star.r * 10, star.r * 10); }
          bctx!.globalAlpha = 1;
          bctx!.fillStyle = `rgba(${star.color}, ${star.alpha})`;
          bctx!.beginPath(); bctx!.arc(x, y, star.r, 0, 2 * Math.PI); bctx!.fill();
        }
        bctx!.globalAlpha = 1;
        bctx!.globalCompositeOperation = "source-over";
      }
    }
  }
  raf = requestAnimationFrame(frame);
  return () => { stopped = true; cancelAnimationFrame(raf); };
}
