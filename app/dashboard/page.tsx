import { Avatar } from "@/components/avatar";
import { SignOutButton } from "@/components/sign-out-button";
import { requireOnboarded } from "@/lib/auth-guards";
import { displayName } from "@/lib/display-name";

export default async function DashboardPage() {
  const user = await requireOnboarded();
  const name = displayName(user.name, user.email);

  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-6 px-6 text-center">
      <Avatar src={user.image} alt={`${name}'s avatar`} />
      <h1 className="text-3xl font-semibold tracking-tight">{name}</h1>
      <p className="text-zinc-600 dark:text-zinc-400">{user.email}</p>
      <div>
        <p className="text-sm text-zinc-500 dark:text-zinc-400">Your favorite movie</p>
        <p className="text-xl font-medium">
          <bdi>{user.favoriteMovie}</bdi>
        </p>
      </div>
      {/* Ticket 05 fills this with the movie fact; the page never waits for it. */}
      <section aria-label="Movie fact" />
      <SignOutButton />
    </main>
  );
}
