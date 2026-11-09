"use server";

import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth-guards";
import { movieTitleSchema } from "@/lib/movie-title";

export type SaveFavoriteMovieState = { error: string | null };

export async function saveFavoriteMovie(
  _prevState: SaveFavoriteMovieState,
  formData: FormData,
): Promise<SaveFavoriteMovieState> {
  // User id comes from the session.
  const user = await requireUser();

  // Non-string input counts as empty.
  const raw = formData.get("title");
  const parsed = movieTitleSchema.safeParse(typeof raw === "string" ? raw : "");
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  // Saves only if no movie is set yet.
  const { count } = await prisma.user.updateMany({
    where: { id: user.id, favoriteMovie: null },
    data: { favoriteMovie: parsed.data },
  });
  if (count === 0) return { error: "You've already saved a favorite movie." };

  redirect("/dashboard");
}
