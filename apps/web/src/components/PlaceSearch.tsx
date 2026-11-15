import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { Place, PlaceKind } from "@nexxus/contract";
import { api } from "../api";
import { useI18n } from "../i18n";

type Kind = PlaceKind | "all";

/** Onde a busca está restrita: um país e, dentro dele, talvez um estado. */
interface Scope {
  countryCode: string;
  countryName: string;
  state?: { key: string; name: string };
}

function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => { const timer = setTimeout(() => setV(value), ms); return () => clearTimeout(timer); }, [value, ms]);
  return v;
}

/**
 * Busca de lugar. Funciona de dois jeitos que se somam:
 * digitar qualquer nome, ou escolher um país e afunilar para estado e cidade.
 * Cada país ou estado escolhido vira um filtro ao lado do campo.
 */
export function PlaceSearch({ onPick }: { onPick(place: Place): void }) {
  const { t, lang } = useI18n();
  const [text, setText] = useState("");
  const [kind, setKind] = useState<Kind>("all");
  const [scope, setScope] = useState<Scope | null>(null);
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLFormElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const query = useDebounced(text.trim(), 200);

  // dentro de um estado só há cidades; dentro de um país não há países
  const kinds: Kind[] = scope?.state ? [] : scope ? ["all", "state", "city"] : ["all", "city", "state", "country"];
  const activeKind: Kind = scope?.state ? "city" : kinds.includes(kind) ? kind : "all";
  const canList = Boolean(scope) || query.length >= 2;

  const { data: hits = [], isFetching, isError } = useQuery({
    queryKey: ["places", query, activeKind, lang, scope?.countryCode, scope?.state?.key],
    queryFn: () => api.searchPlaces(query, { kind: activeKind, lang, countryCode: scope?.countryCode, adminKey: scope?.state?.key }),
    enabled: canList,
  });

  useEffect(() => {
    // composedPath guarda o caminho do clique mesmo se o item clicado já saiu da tela ao trocar a lista
    const close = (e: MouseEvent) => { if (box.current && !e.composedPath().includes(box.current)) setOpen(false); };
    document.addEventListener("click", close);
    return () => document.removeEventListener("click", close);
  }, []);

  function pick(place: Place) {
    onPick(place);
    if (place.kind === "city" || !place.countryCode) {
      setText(place.name);
      setOpen(false);
      return;
    }
    // país ou estado: vira filtro e a lista continua aberta para afunilar
    setScope(place.kind === "country"
      ? { countryCode: place.countryCode, countryName: place.name }
      : { countryCode: place.countryCode, countryName: place.country ?? place.countryCode, state: { key: place.adminKey ?? place.name, name: place.name } });
    setText("");
    setOpen(true);
    input.current?.focus();
  }
  function dropLast() {
    setScope((s) => (s?.state ? { countryCode: s.countryCode, countryName: s.countryName } : null));
  }
  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Escape") { setOpen(false); return; }
    if (e.key === "Backspace" && !text && scope && e.target === input.current) { dropLast(); return; }
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    const items = [...(box.current?.querySelectorAll<HTMLElement>("#place, .search__hit") ?? [])];
    const next = items[items.indexOf(document.activeElement as HTMLElement) + (e.key === "ArrowDown" ? 1 : -1)];
    if (next) { e.preventDefault(); next.focus(); }
  }

  const placeholder = scope?.state ? t.search.inState(scope.state.name) : scope ? t.search.inCountry(scope.countryName) : t.search.placeholder;
  const waiting = isFetching || query !== text.trim();
  return (
    <form className="search" ref={box} role="search" onKeyDown={onKeyDown}
      onSubmit={(e) => { e.preventDefault(); if (hits[0] && text.trim()) pick(hits[0]); }}>
      <label htmlFor="place">{t.search.label}</label>
      {scope && (
        <span className="search__scope">
          <button type="button" onClick={() => { setScope(null); input.current?.focus(); }} aria-label={t.search.remove(scope.countryName)}>
            {scope.countryName}<i aria-hidden="true">×</i>
          </button>
          {scope.state && (
            <button type="button" onClick={() => { dropLast(); input.current?.focus(); }} aria-label={t.search.remove(scope.state.name)}>
              {scope.state.name}<i aria-hidden="true">×</i>
            </button>
          )}
        </span>
      )}
      <input id="place" ref={input} type="text" autoComplete="off" value={text} placeholder={placeholder}
        onChange={(e) => { setText(e.target.value); setOpen(true); }} onFocus={() => setOpen(true)} />
      {open && canList && (
        <div className="search__drop">
          {kinds.length > 0 && (
            <div className="search__kinds" role="group" aria-label={t.search.filterAria}>
              {kinds.map((k) => (
                <button key={k} type="button" aria-pressed={activeKind === k} onClick={() => setKind(k)}>{t.search.kinds[k]}</button>
              ))}
            </div>
          )}
          <ul>
            {hits.map((p) => (
              <li key={`${p.kind}-${p.name}-${p.lat}-${p.lon}`}>
                <button type="button" className="search__hit" onClick={() => pick(p)}>
                  <span className="search__name">
                    {p.name}
                    <small>{(scope?.state ? [] : scope ? [p.admin] : [p.admin, p.country]).filter(Boolean).join(" · ")}</small>
                  </span>
                  <span className="search__tag">{t.search.tag[p.kind]}{p.kind !== "city" && p.countryCode ? " ›" : ""}</span>
                </button>
              </li>
            ))}
            {!hits.length && (
              <li className="search__none">
                {isError ? t.search.failed : waiting ? t.search.searching : scope ? t.search.noneInside : t.search.none}
              </li>
            )}
          </ul>
        </div>
      )}
    </form>
  );
}
