"use client";

import { useEffect, useState } from "react";

type State =
  | { status: "loading" }
  | { status: "ok"; text: string }
  | { status: "pending"; text: string | null; gaveUp: boolean }
  | { status: "error"; message: string };

const FALLBACK_ERROR = "Couldn't get a movie fact right now.";
const POLL_MS = 1500;
const MAX_POLLS = 10;

export function FactCard() {
  const [state, setState] = useState<State>({ status: "loading" });

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let polls = 0;

    // Fetches the fact; on 202 shows the stale fact and polls again, up to MAX_POLLS times.
    async function load() {
      try {
        const res = await fetch("/api/fact", { cache: "no-store" });
        const body = await res.json().catch(() => null);
        if (cancelled) return;
        if (res.status === 202) {
          const text = typeof body?.fact?.text === "string" ? body.fact.text : null;
          const gaveUp = polls >= MAX_POLLS;
          setState({ status: "pending", text, gaveUp });
          if (!gaveUp) {
            polls++;
            timer = setTimeout(load, POLL_MS);
          }
        } else if (res.ok && typeof body?.fact?.text === "string") {
          setState({ status: "ok", text: body.fact.text });
        } else {
          const message = typeof body?.error === "string" ? body.error : FALLBACK_ERROR;
          setState({ status: "error", message });
        }
      } catch {
        if (!cancelled) setState({ status: "error", message: FALLBACK_ERROR });
      }
    }

    load();
    // Stops polling and ignores late responses after unmount.
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, []);

  const busy = state.status === "loading" || (state.status === "pending" && !state.gaveUp);

  return (
    <section
      aria-label="Movie fact"
      aria-busy={busy}
      className="w-full max-w-md rounded-lg border border-zinc-200 p-4 text-left dark:border-zinc-800"
    >
      <p className="text-sm text-zinc-500 dark:text-zinc-400">Movie fact</p>
      {state.status === "loading" && (
        <p className="mt-1 animate-pulse text-zinc-500 dark:text-zinc-400">Finding a fact…</p>
      )}
      {state.status === "ok" && <p className="mt-1">{state.text}</p>}
      {state.status === "pending" && (
        <>
          {state.text && <p className="mt-1">{state.text}</p>}
          {state.gaveUp ? (
            <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
              A new fact is taking longer than usual. Refresh in a moment to see it.
            </p>
          ) : (
            <p className="mt-1 animate-pulse text-sm text-zinc-500 dark:text-zinc-400">Generating fact…</p>
          )}
        </>
      )}
      {state.status === "error" && (
        <p role="alert" className="mt-1 text-red-600 dark:text-red-400">
          {state.message}
        </p>
      )}
    </section>
  );
}
