import { SignOutButton } from "@/components/sign-out-button";
import { requireOnboarded } from "@/lib/auth-guards";

export default async function DashboardPage() {
  await requireOnboarded();

  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-6 px-6 text-center">
      <h1 className="text-3xl font-semibold tracking-tight">Dashboard</h1>
      <p className="text-zinc-600 dark:text-zinc-400">Coming in a later slice.</p>
      <SignOutButton />
    </main>
  );
}
