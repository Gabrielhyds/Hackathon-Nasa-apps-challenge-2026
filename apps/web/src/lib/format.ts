import type { Lang } from "@nexxus/contract";

const MONTHS: Record<Lang, string[]> = {
  en: ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"],
  pt: ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"],
};

export interface Format {
  num(n: number, digits?: number): string;
  /** "2026-11-03" → "3 Nov 2026" em inglês, "03/11/2026" em português */
  date(iso: string): string;
  /** "2026-11-03" → "03 Nov" */
  shortDate(iso: string): string;
  coords(lat: number, lon: number): string;
  /** Hora e minuto de um instante ISO, no fuso de quem está vendo: "14:20" */
  time(iso: string): string;
}

/** Formatação de números, datas e coordenadas no idioma da interface. */
export function makeFormat(lang: Lang): Format {
  const locale = lang === "pt" ? "pt-BR" : "en-US";
  const num = (n: number, digits = 0) => n.toLocaleString(locale, { minimumFractionDigits: digits, maximumFractionDigits: digits });
  const month = (iso: string) => MONTHS[lang][Number(iso.slice(5, 7)) - 1];
  const [east, west] = lang === "pt" ? ["L", "O"] : ["E", "W"];
  return {
    num,
    date: (iso) => (lang === "pt" ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : `${Number(iso.slice(8, 10))} ${month(iso)} ${iso.slice(0, 4)}`),
    shortDate: (iso) => `${iso.slice(8, 10)} ${month(iso)}`,
    time: (iso) => new Date(iso).toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" }),
    coords: (lat, lon) => `${num(Math.abs(lat), 1)}°${lat >= 0 ? "N" : "S"} ${num(Math.abs(lon), 1)}°${lon >= 0 ? east : west}`,
  };
}

export const placeLabel = (p: { name: string; admin?: string; country?: string }) =>
  [p.name, p.admin, p.country].filter(Boolean).join(", ");
