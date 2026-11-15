import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import type { Lang } from "@nexxus/contract";
import { makeFormat, type Format } from "../lib/format";
import { parseUrlState } from "../lib/urlState";
import { en, type Dict } from "./en";
import { pt } from "./pt";

/**
 * Idiomas da interface. Inglês é o principal.
 * Texto novo: adicione a chave em en.ts e em pt.ts (o TypeScript acusa se faltar em um deles).
 */
export const LANGS: { id: Lang; label: string }[] = [
  { id: "en", label: "EN" },
  { id: "pt", label: "PT" },
];
const DICTS: Record<Lang, Dict> = { en, pt };
const STORAGE_KEY = "nexxus-lang";

interface I18n { lang: Lang; setLang(lang: Lang): void; t: Dict; f: Format }
const Context = createContext<I18n | null>(null);

function initialLang(): Lang {
  // um link com ?lang= vale mais que a escolha lembrada: quem recebe o link vê no idioma de quem mandou
  const fromUrl = parseUrlState(window.location.search).lang;
  if (fromUrl) return fromUrl;
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved === "en" || saved === "pt") return saved;
  } catch { /* sem armazenamento: usa o padrão */ }
  return "en";
}

export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(initialLang);
  useEffect(() => { document.documentElement.lang = lang === "pt" ? "pt-BR" : "en"; }, [lang]);
  const value = useMemo<I18n>(() => ({
    lang,
    setLang(next) {
      setLangState(next);
      try { localStorage.setItem(STORAGE_KEY, next); } catch { /* segue sem lembrar */ }
    },
    t: DICTS[lang],
    f: makeFormat(lang),
  }), [lang]);
  return <Context.Provider value={value}>{children}</Context.Provider>;
}

export function useI18n(): I18n {
  const value = useContext(Context);
  if (!value) throw new Error("useI18n precisa estar dentro de <I18nProvider>.");
  return value;
}
