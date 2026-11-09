import { prisma } from "@/lib/prisma";

export const TEST_EMAIL_DOMAIN = "@test.movie-memory.local";

// Deletes every test-domain user; cascades remove their accounts, sessions and facts.
export async function cleanup() {
  await prisma.user.deleteMany({ where: { email: { endsWith: TEST_EMAIL_DOMAIN } } });
}
