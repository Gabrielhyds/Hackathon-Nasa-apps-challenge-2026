/**
 * TRILHA DE FUNDO. Duas faixas, uma por momento da tela: a de explorar (globo, abertura, história da cena, conversa)
 * e a de dados (nível Dados, laboratório, mapa de mudança). A troca é uma transição de volume; quem toca é
 * lib/useSoundtrack.ts. Aqui fica só a regra, que é pura.
 *
 * As duas são CC0 (domínio público), do OpenGameArt:
 *   explore: "Exploration Theme", de Cleyton Kauffman   https://opengameart.org/content/exploration-theme
 *   data:    "Cosmic Navigation", de Synth-thetic        https://opengameart.org/content/cosmic-navigation
 * Os arquivos de assets/audio são a versão de loop de cada uma, em MP3 de 96 kbps, com o volume igualado (−22 LUFS).
 */
import type { Audience } from "./audience";
import type { Lab, Tab, View } from "./urlState";

export type Track = "explore" | "data";
export const TRACKS: Track[] = ["explore", "data"];

export interface Screen {
  /** A abertura está na tela. */
  intro: boolean;
  tab: Tab;
  audience: Audience;
  /** Ferramenta do laboratório aberta, se houver. */
  lab: Lab | null;
  /** Há uma cena aberta de propósito (o mapa está nela, com o divisor). */
  opened: boolean;
  view: View;
}

/** Qual faixa acompanha a tela: a de dados onde há medida ou método à vista, a de explorar no resto. */
export function trackFor(screen: Screen): Track {
  if (screen.intro) return "explore";
  if (screen.lab) return "data";
  if (screen.tab !== "scenes") return "explore";
  if (screen.audience === "analyze") return "data";
  return screen.opened && screen.view === "change" ? "data" : "explore";
}

const KEY = "nexxus-sound";
/** O som fica ligado até alguém desligar; a escolha é lembrada. */
export function savedSound(): boolean {
  try { return localStorage.getItem(KEY) !== "0"; } catch { return true; }
}
export function saveSound(on: boolean): void {
  try { localStorage.setItem(KEY, on ? "1" : "0"); } catch { /* segue sem lembrar */ }
}

/** Bytes de um endereço `data:` em base64. No preview os áudios vêm embutidos assim, porque lá não há fetch. */
export function dataUrlBytes(url: string): Uint8Array | null {
  const match = /^data:[^,]*;base64,(.*)$/s.exec(url);
  if (!match) return null;
  const text = atob(match[1]);
  const bytes = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i++) bytes[i] = text.charCodeAt(i);
  return bytes;
}
