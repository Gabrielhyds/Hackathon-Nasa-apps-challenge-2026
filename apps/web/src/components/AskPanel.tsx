import { useEffect, useRef, useState } from "react";
import type { Scene } from "@nexxus/contract";
import { useI18n } from "../i18n";
import type { Chat } from "../lib/useChat";

/** `context` são as cenas sobre as quais o agente responde: a aberta e as marcadas para comparar. */
interface Props { chat: Chat; scenes: Scene[]; context: string[]; suggestions: string[]; onOpenScene(id: string): void }

export function AskPanel({ chat, scenes, context, suggestions, onOpenScene }: Props) {
  const { t } = useI18n();
  const [text, setText] = useState("");
  const end = useRef<HTMLDivElement>(null);
  const about = context.map((id) => scenes.find((s) => s.id === id)).filter((s): s is Scene => Boolean(s));
  const last = chat.turns[chat.turns.length - 1];

  // acompanha a resposta enquanto ela cresce
  useEffect(() => { end.current?.scrollIntoView({ block: "nearest" }); }, [chat.turns.length, last?.answer.length, last?.status]);

  function submit(question: string) {
    if (!question.trim() || chat.busy) return;
    setText("");
    void chat.send(question);
  }

  return (
    <div className="chat">
      <div className="stack stack--tight">
        <p className="meta">{about.length ? t.ask.context : t.ask.noContext}</p>
        {about.length > 0 && (
          <div className="cites">
            {about.map((s) => <button key={s.id} type="button" onClick={() => onOpenScene(s.id)}>{s.name}</button>)}
          </div>
        )}
      </div>

      {chat.turns.length === 0 ? (
        <ul className="suggest">
          {suggestions.map((q) => (
            <li key={q}><button type="button" onClick={() => submit(q)}>{q}</button></li>
          ))}
        </ul>
      ) : (
        <div className="turns" aria-live="polite">
          {chat.turns.map((turn) => (
            <article key={turn.id} className="turn">
              <h3>{turn.question}</h3>
              {turn.answer && <p className={turn.status === "streaming" ? "turn__text turn__text--live" : "turn__text"}>{turn.answer}</p>}
              {turn.status === "streaming" && !turn.answer && <p className="muted pulse">{t.ask.thinking}</p>}
              {turn.status === "stopped" && <p className="meta">{t.ask.stopped}</p>}
              {turn.status === "error" && (
                <div className="stack stack--tight">
                  <p className="muted">{t.ask.failed}</p>
                  <button type="button" className="link" onClick={() => chat.retry(turn.id)}>{t.ask.retry}</button>
                </div>
              )}
              {turn.status === "done" && turn.citations.length > 0 && (
                <div className="cites">
                  {turn.citations.map((id) => {
                    const scene = scenes.find((s) => s.id === id);
                    return scene ? <button key={id} type="button" onClick={() => onOpenScene(id)}>{scene.name}</button> : null;
                  })}
                </div>
              )}
              {turn.status === "done" && turn.isExample && <p className="meta">{t.ask.example}</p>}
            </article>
          ))}
          <div ref={end} />
        </div>
      )}

      <div className="chat__foot">
        <form className="ask" onSubmit={(e) => { e.preventDefault(); submit(text); }}>
          <input type="text" value={text} onChange={(e) => setText(e.target.value)} placeholder={t.ask.placeholder}
            aria-label={t.ask.inputAria} autoComplete="off" />
          {chat.busy
            ? <button type="button" onClick={chat.stop}>{t.ask.stop}</button>
            : <button type="submit" disabled={!text.trim()}>{t.ask.send}</button>}
        </form>
        {chat.turns.length > 0 && !chat.busy && (
          <button type="button" className="chat__clear" onClick={chat.clear}>{t.ask.clear}</button>
        )}
      </div>
    </div>
  );
}
