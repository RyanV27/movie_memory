import NextAuth from "next-auth";
import Google from "next-auth/providers/google";
import { PrismaAdapter } from "@auth/prisma-adapter";
import { prisma } from "@/lib/prisma";

export const { handlers, auth, signIn, signOut } = NextAuth({
  adapter: PrismaAdapter(prisma),
  providers: [Google],
  session: { strategy: "database" },
  callbacks: {
    // Adds id and favoriteMovie to the session user.
    session({ session, user }) {
      session.user.id = user.id;
      session.user.favoriteMovie = (user as { favoriteMovie?: string | null }).favoriteMovie ?? null;
      return session;
    },
  },
});
