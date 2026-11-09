import "server-only";
import { redirect } from "next/navigation";
import type { Session } from "next-auth";
import { auth } from "@/auth";

type SessionUser = Session["user"];

export function hasFavoriteMovie(user: SessionUser): boolean {
  return user.favoriteMovie != null;
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
