"use client";

import { useActionState } from "react";
import { saveFavoriteMovie } from "./actions";

export function MovieForm() {
  const [state, formAction, pending] = useActionState(saveFavoriteMovie, { error: null });

  return (
    <form action={formAction} className="flex w-full max-w-sm flex-col gap-4">
      <label htmlFor="title" className="text-left text-sm font-medium">
        Favorite movie
      </label>
      <input
        id="title"
        name="title"
        type="text"
        required
        autoComplete="off"
        className="rounded-lg border border-zinc-300 bg-transparent px-3 py-2 dark:border-zinc-700"
      />
      {state.error && (
        <p role="alert" className="text-left text-sm text-red-600 dark:text-red-400">
          {state.error}
        </p>
      )}
      <button
        type="submit"
        disabled={pending}
        className="rounded-full bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-700 disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
      >
        {pending ? "Saving…" : "Save"}
      </button>
    </form>
  );
}
