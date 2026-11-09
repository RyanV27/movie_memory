import { redirect } from "next/navigation";
import { SignOutButton } from "@/components/sign-out-button";
import { hasFavoriteMovie, requireUser } from "@/lib/auth-guards";
import { MovieForm } from "./movie-form";

export default async function OnboardingPage() {
  const user = await requireUser();
  if (hasFavoriteMovie(user)) redirect("/dashboard");

  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-6 px-6 text-center">
      <h1 className="text-3xl font-semibold tracking-tight">What&apos;s your favorite movie?</h1>
      <p className="text-zinc-600 dark:text-zinc-400">You can only set this once.</p>
      <MovieForm />
      <SignOutButton />
    </main>
  );
}
