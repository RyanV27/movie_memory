import "server-only";
import { redirect } from "next/navigation";
import type { Session } from "next-auth";
import { auth } from "@/auth";

type SessionUser = Session["user"];

// Ticket 03 replaces this with a check of User.favoriteMovie.
export function hasFavoriteMovie(user: SessionUser): boolean {
  void user;
  return false;
}

export async function requireUser() {
  const session = await auth();
  if (!session?.user) redirect("/");
  return session.user;
}

export async function requireOnboarded() {
  const user = await requireUser();
  if (!hasFavoriteMovie(user)) redirect("/onboarding");
  return user;
}
