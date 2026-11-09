"use client";

import { useEffect, useRef, useState } from "react";

type State =
  | { status: "loading" }
  | { status: "ok"; text: string }
  | { status: "error"; message: string };

const FALLBACK_ERROR = "Couldn't get a movie fact right now.";

export function FactCard() {
  const [state, setState] = useState<State>({ status: "loading" });
  // Stops Strict Mode's second effect run from sending a second request.
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;

    fetch("/api/fact", { cache: "no-store" })
      .then(async (res) => {
        const body = await res.json().catch(() => null);
        if (res.ok && typeof body?.fact?.text === "string") {
          setState({ status: "ok", text: body.fact.text });
        } else {
          const message = typeof body?.error === "string" ? body.error : FALLBACK_ERROR;
          setState({ status: "error", message });
        }
      })
      .catch(() => setState({ status: "error", message: FALLBACK_ERROR }));
  }, []);

  return (
    <section
      aria-label="Movie fact"
      aria-busy={state.status === "loading"}
      className="w-full max-w-md rounded-lg border border-zinc-200 p-4 text-left dark:border-zinc-800"
    >
      <p className="text-sm text-zinc-500 dark:text-zinc-400">Movie fact</p>
      {state.status === "loading" && (
        <p className="mt-1 animate-pulse text-zinc-500 dark:text-zinc-400">Finding a fact…</p>
      )}
      {state.status === "ok" && <p className="mt-1">{state.text}</p>}
      {state.status === "error" && (
        <p role="alert" className="mt-1 text-red-600 dark:text-red-400">
          {state.message}
        </p>
      )}
    </section>
  );
}
