import type { PrismaClient } from "@/generated/prisma/client";
import type { FactWriter } from "@/lib/fact/writer";

export type FactDeps = {
  db: Pick<PrismaClient, "user" | "fact" | "$queryRaw">;
  writer: FactWriter;
};

export type FactView = { text: string; createdAt: Date };

export type FactResult =
  | { kind: "no-movie" }
  | { kind: "ok"; fact: FactView; source: "generated" | "cached" };

export async function getFact(userId: string, deps: FactDeps): Promise<FactResult> {
  const user = await deps.db.user.findUnique({
    where: { id: userId },
    select: { favoriteMovie: true },
  });
  const movieTitle = user?.favoriteMovie;
  if (!movieTitle) return { kind: "no-movie" };

  // Raw query: Prisma can't filter on clock_timestamp().
  const [cached] = await deps.db.$queryRaw<FactView[]>`
    SELECT "text", "createdAt" FROM "Fact"
    WHERE "userId" = ${userId} AND "movieTitle" = ${movieTitle}
      AND "createdAt" > clock_timestamp() - interval '60 seconds'
    ORDER BY "createdAt" DESC LIMIT 1`;
  if (cached) return { kind: "ok", fact: cached, source: "cached" };

  const text = await deps.writer.write(movieTitle);
  const fact = await deps.db.fact.create({
    data: { userId, movieTitle, text },
    select: { text: true, createdAt: true },
  });
  return { kind: "ok", fact, source: "generated" };
}
