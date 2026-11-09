import type { PrismaClient } from "@/generated/prisma/client";
import type { FactWriter } from "@/lib/fact/writer";

export type FactDeps = {
  db: Pick<PrismaClient, "user" | "fact">;
  writer: FactWriter;
};

export type FactView = { text: string; createdAt: Date };

export type FactResult =
  | { kind: "no-movie" }
  | { kind: "ok"; fact: FactView; source: "generated" };

export async function getFact(userId: string, deps: FactDeps): Promise<FactResult> {
  const user = await deps.db.user.findUnique({
    where: { id: userId },
    select: { favoriteMovie: true },
  });
  const movieTitle = user?.favoriteMovie;
  if (!movieTitle) return { kind: "no-movie" };

  const text = await deps.writer.write(movieTitle);
  const fact = await deps.db.fact.create({
    data: { userId, movieTitle, text },
    select: { text: true, createdAt: true },
  });
  return { kind: "ok", fact, source: "generated" };
}
