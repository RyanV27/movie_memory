import { redirect } from "next/navigation";
import { auth, signIn } from "@/auth";
import { hasFavoriteMovie } from "@/lib/auth-guards";

export default async function Home() {
  const session = await auth();
  if (session?.user) {
    redirect(hasFavoriteMovie(session.user) ? "/dashboard" : "/onboarding");
  }

  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-6 px-6 text-center">
      <h1 className="text-4xl font-semibold tracking-tight">Movie Memory</h1>
      <p className="max-w-md text-lg text-zinc-600 dark:text-zinc-400">
        Tell us your favorite movie and get a fun fact about it.
      </p>
      <form
        action={async () => {
          "use server";
          await signIn("google", { redirectTo: "/" });
        }}
      >
        <button
          type="submit"
          className="rounded-full bg-foreground px-6 py-3 font-medium text-background hover:opacity-90"
        >
          Sign in with Google
        </button>
      </form>
    </main>
  );
}
