import type { Scene } from "@nexxus/contract";

/**
 * IMAGEM ÓPTICA DO DIA DO EVENTO. A cena diz o dia e a região (`scene.opticalDay`); a imagem acompanha a página, em
 * assets/optical/<cena>-<data>.webp, gravada por scripts/optical_day.py. Entra no pacote: funciona sem API e sem
 * rede. Sem o arquivo, não há comparação para oferecer.
 *
 * Na tela ela cobre o mapa em volta da cena, e a imagem de radar fica dentro da moldura, como uma janela na nuvem.
 * A imagem tem 250 m por pixel e a cena, uns 25 km: de perto seria um borrão branco. Por isso o modo óptico
 * afasta o mapa (`opticalFrame`) até a nuvem ter textura.
 */
type Box = readonly [number, number, number, number];
type WithOptical = Pick<Scene, "id" | "bbox" | "opticalDay">;

const FILES = import.meta.glob<string>("../assets/optical/*.webp", { eager: true, query: "?url", import: "default" });
const IMAGES: Record<string, string> = Object.fromEntries(Object.entries(FILES).map(([path, url]) => [path.split("/").pop()!.replace(/\.webp$/, ""), url]));

/** Quantas vezes o lado da cena cabe no enquadramento do modo óptico. */
export const OPTICAL_SPAN = 2.8;

/** Nome do arquivo (sem extensão) da imagem óptica de uma cena. */
export const opticalKey = (scene: Pick<Scene, "id" | "opticalDay">): string | null => (scene.opticalDay ? `${scene.id}-${scene.opticalDay.date}` : null);

/** Endereço da imagem óptica da cena, ou `null` se a cena não tem uma ou o arquivo não veio. */
export function opticalImage(scene: Pick<Scene, "id" | "opticalDay">): string | null {
  const key = opticalKey(scene);
  return (key && IMAGES[key]) || null;
}

/** Os quatro cantos de uma região, na ordem que o mapa pede: noroeste, nordeste, sudeste, sudoeste. */
export function corners(bbox: Box): [[number, number], [number, number], [number, number], [number, number]] {
  const [w, s, e, n] = bbox;
  return [[w, n], [e, n], [e, s], [w, s]];
}

/** A região óptica precisa conter a cena: senão a janela de radar ficaria sobre o mapa de fundo, fora da nuvem. */
export function coversScene(scene: Pick<Scene, "bbox" | "opticalDay">): boolean {
  const o = scene.opticalDay?.bbox, b = scene.bbox;
  return Boolean(o) && o![0] <= b[0] && o![1] <= b[1] && o![2] >= b[2] && o![3] >= b[3];
}

/** A cena tem imagem óptica para mostrar: o campo, o arquivo e uma região que a contém. */
export const hasOptical = (scene: WithOptical): boolean => opticalImage(scene) !== null && coversScene(scene);

/**
 * Enquadramento do modo óptico: a cena no centro, com `span` vezes o lado dela de cada dimensão, sem sair da região
 * da imagem. `null` em cena sem imagem óptica.
 */
export function opticalFrame(scene: Pick<Scene, "bbox" | "opticalDay">, span = OPTICAL_SPAN): [number, number, number, number] | null {
  const o = scene.opticalDay?.bbox;
  if (!o || !coversScene(scene)) return null;
  const [w, s, e, n] = scene.bbox, dx = ((e - w) * (span - 1)) / 2, dy = ((n - s) * (span - 1)) / 2;
  return [Math.max(o[0], w - dx), Math.max(o[1], s - dy), Math.min(o[2], e + dx), Math.min(o[3], n + dy)];
}
