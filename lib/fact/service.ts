import type { PrismaClient } from "@/generated/prisma/client";
import type { FactWriter } from "@/lib/fact/writer";

export type FactDeps = {
  db: Pick<PrismaClient, "user" | "fact" | "$queryRaw" | "$transaction">;
  writer: FactWriter;
  aiTimeoutMs?: number;
};

export type FactView = { text: string; createdAt: Date };

export type FactResult =
  | { kind: "no-movie" }
  | { kind: "ok"; fact: FactView; source: "generated" | "cached" | "stale" }
  | { kind: "pending"; fact: FactView | null }
  | { kind: "failed" };

// The AI timeout must stay below the transaction timeout so a timeout reaches the fallback.
export const AI_TIMEOUT_MS = 10_000;
export const TX_TIMEOUT_MS = 15_000;

// First key of the two-key advisory lock: namespaces fact generation.
const FACT_LOCK_NAMESPACE = 7001;

// Latest Fact under 60s old, aged by clock_timestamp() (now() is frozen inside a transaction).
async function freshFact(db: Pick<PrismaClient, "$queryRaw">, userId: string, movieTitle: string) {
  const [fact] = await db.$queryRaw<FactView[]>`
    SELECT "text", "createdAt" FROM "Fact"
    WHERE "userId" = ${userId} AND "movieTitle" = ${movieTitle}
      AND "createdAt" > clock_timestamp() - interval '60 seconds'
    ORDER BY "createdAt" DESC LIMIT 1`;
  return fact;
}

// Latest Fact of any age for this movie.
function latestFact(db: Pick<PrismaClient, "fact">, userId: string, movieTitle: string) {
  return db.fact.findFirst({
    where: { userId, movieTitle },
    orderBy: { createdAt: "desc" },
    select: { text: true, createdAt: true },
  });
}

// Calls the writer with an abort signal and rejects when the timeout fires, even if the writer ignores it.
async function writeWithTimeout(writer: FactWriter, movieTitle: string, ms: number) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error(`AI call timed out after ${ms}ms`)), ms);
  let onAbort!: () => void;
  const aborted = new Promise<never>((_, reject) => {
    onAbort = () => reject(controller.signal.reason);
    controller.signal.addEventListener("abort", onAbort, { once: true });
  });
  try {
    return await Promise.race([writer.write(movieTitle, controller.signal), aborted]);
  } finally {
    clearTimeout(timer);
    controller.signal.removeEventListener("abort", onAbort);
  }
}

export async function getFact(userId: string, deps: FactDeps): Promise<FactResult> {
  const user = await deps.db.user.findUnique({
    where: { id: userId },
    select: { favoriteMovie: true },
  });
  const movieTitle = user?.favoriteMovie;
  if (!movieTitle) return { kind: "no-movie" };

  const cached = await freshFact(deps.db, userId, movieTitle);
  if (cached) return { kind: "ok", fact: cached, source: "cached" };

  return deps.db.$transaction(
    async (tx): Promise<FactResult> => {
      // Per-user try-lock, released at transaction end; rare hashtext collisions only cause a spurious pending.
      const [{ locked }] = await tx.$queryRaw<{ locked: boolean }[]>`
        SELECT pg_try_advisory_xact_lock(${FACT_LOCK_NAMESPACE}::int, hashtext(${userId})) AS locked`;
      if (!locked) {
        // Another request is generating: return the latest Fact of any age.
        return { kind: "pending", fact: await latestFact(tx, userId, movieTitle) };
      }

      // Re-check after taking the lock: a request that just released it may have stored a fresh Fact.
      const fresh = await freshFact(tx, userId, movieTitle);
      if (fresh) return { kind: "ok", fact: fresh, source: "cached" };

      let text: string;
      try {
        text = await writeWithTimeout(deps.writer, movieTitle, deps.aiTimeoutMs ?? AI_TIMEOUT_MS);
      } catch (error) {
        // AI failed or timed out: fall back to the latest Fact, storing nothing.
        console.error("Fact generation failed", error);
        const stale = await latestFact(tx, userId, movieTitle);
        return stale ? { kind: "ok", fact: stale, source: "stale" } : { kind: "failed" };
      }
      // createdAt defaults to clock_timestamp(), so it isn't stamped with the transaction start.
      const fact = await tx.fact.create({
        data: { userId, movieTitle, text },
        select: { text: true, createdAt: true },
      });
      return { kind: "ok", fact, source: "generated" };
    },
    { timeout: TX_TIMEOUT_MS, maxWait: 5000 },
  );
}
