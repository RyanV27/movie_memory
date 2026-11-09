import type { PrismaClient } from "@/generated/prisma/client";
import type { FactWriter } from "@/lib/fact/writer";

export type FactDeps = {
  db: Pick<PrismaClient, "user" | "fact" | "$queryRaw" | "$transaction">;
  writer: FactWriter;
};

export type FactView = { text: string; createdAt: Date };

export type FactResult =
  | { kind: "no-movie" }
  | { kind: "ok"; fact: FactView; source: "generated" | "cached" }
  | { kind: "pending"; fact: FactView | null };

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
        const latest = await tx.fact.findFirst({
          where: { userId, movieTitle },
          orderBy: { createdAt: "desc" },
          select: { text: true, createdAt: true },
        });
        return { kind: "pending", fact: latest };
      }

      // Re-check after taking the lock: a request that just released it may have stored a fresh Fact.
      const fresh = await freshFact(tx, userId, movieTitle);
      if (fresh) return { kind: "ok", fact: fresh, source: "cached" };
      
      const text = await deps.writer.write(movieTitle);
      // createdAt defaults to clock_timestamp(), so it isn't stamped with the transaction start.
      const fact = await tx.fact.create({
        data: { userId, movieTitle, text },
        select: { text: true, createdAt: true },
      });
      return { kind: "ok", fact, source: "generated" };
    },
    { timeout: 15000, maxWait: 5000 },
  );
}
