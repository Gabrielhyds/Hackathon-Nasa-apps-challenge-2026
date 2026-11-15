import type { Criterion, Polarization, Release, Scene } from "@nexxus/contract";

/**
 * ORIGEM DAS IMAGENS de uma cena, para quem quiser conferir: de que granule e de que versão do produto saiu cada
 * passagem, que valor vira branco e quanto do recorte ficou sem dado. Tudo vem pronto da API (campos opcionais do
 * contrato); aqui só se arruma para a tela. Sem os campos (imagem de exemplo), as funções devolvem vazio.
 */

/** Versões do produto das passagens da cena, sem repetir, na ordem em que aparecem. Uma cena pode misturar duas. */
export function releases(scene: Pick<Scene, "acquisitions">): Release[] {
  const out: Release[] = [];
  for (const a of scene.acquisitions) if (a.release && !out.includes(a.release)) out.push(a.release);
  return out;
}

/** As passagens que dizem de onde vieram: data (o par, em interferograma), granule e versão. */
export function passOrigins(scene: Pick<Scene, "acquisitions">): { date: string; referenceDate?: string; granule: string; release?: Release }[] {
  return scene.acquisitions.flatMap((a) => (a.granule ? [{ date: a.date, ...(a.referenceDate ? { referenceDate: a.referenceDate } : {}), granule: a.granule, ...(a.release ? { release: a.release } : {}) }] : []));
}

/** O dB que vira branco em cada polarização da cena, na ordem das polarizações. Só no dado calibrado. */
export function whitePoints(scene: Pick<Scene, "polarizations" | "imageryDetails">): { pol: Polarization; db: number }[] {
  const top = scene.imageryDetails?.topDb;
  return top ? scene.polarizations.flatMap((pol) => (typeof top[pol] === "number" ? [{ pol, db: top[pol] as number }] : [])) : [];
}

/** Parte do recorte sem dado em alguma das datas, em %. `null` quando a API não diz ou quando não falta nada. */
export function missingPct(scene: Pick<Scene, "imageryDetails">): number | null {
  const valid = scene.imageryDetails?.validPct;
  if (typeof valid !== "number" || valid >= 100) return null;
  return Math.round((100 - valid) * 10) / 10;
}

/** Há algo de origem para mostrar? */
export const hasOrigin = (scene: Scene) => passOrigins(scene).length > 0 || whitePoints(scene).length > 0 || missingPct(scene) !== null;

/** As notas do ranking são de exemplo quando algum critério avisa. */
export const exampleScores = (criteria: Criterion[]) => criteria.some((c) => c.isExample);
