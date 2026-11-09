import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/prisma";
import { cleanup, TEST_EMAIL_DOMAIN } from "@/tests/helpers/cleanup";
import { GET } from "@/app/api/fact/route";

// Signed-in user id the mocked auth() returns.
const session = vi.hoisted(() => ({ userId: "" }));

vi.mock("@/auth", () => ({
  auth: async () => ({ user: { id: session.userId } }),
}));

// Writer that must never run: a fresh cached fact should be served.
vi.mock("@/lib/fact/openai-writer", () => ({
  createOpenAIFactWriter: () => ({
    write: async () => {
      throw new Error("writer must not be called");
    },
  }),
}));

beforeAll(async () => {
  await cleanup();
});
afterAll(async () => {
  await cleanup();
  await prisma.$disconnect();
});

describe("GET /api/fact authorization", () => {
  it("never returns another user's fact", async () => {
    // Same movie on purpose: lookup must filter by userId, not just title.
    const a = await prisma.user.create({
      data: { email: `authz-a${TEST_EMAIL_DOMAIN}`, favoriteMovie: "Heat" },
    });
    const b = await prisma.user.create({
      data: { email: `authz-b${TEST_EMAIL_DOMAIN}`, favoriteMovie: "Heat" },
    });
    await prisma.$executeRaw`
      INSERT INTO "Fact" ("id", "userId", "movieTitle", "text", "createdAt")
      VALUES (${`test-${crypto.randomUUID()}`}, ${b.id}, 'Heat', 'B-own fact', clock_timestamp())`;
    // A's fact is inserted last so it is the newest row for the movie.
    await prisma.$executeRaw`
      INSERT INTO "Fact" ("id", "userId", "movieTitle", "text", "createdAt")
      VALUES (${`test-${crypto.randomUUID()}`}, ${a.id}, 'Heat', 'A-SECRET fact', clock_timestamp())`;
    session.userId = b.id;

    const res = await GET();
    const text = await res.text();
    const body = JSON.parse(text);

    expect(res.status).toBe(200);
    expect(body.fact.text).toBe("B-own fact");
    expect(body.source).toBe("cached");
    expect(text).not.toContain("A-SECRET");
    expect(await prisma.fact.count({ where: { userId: b.id } })).toBe(1);
    expect(await prisma.fact.count({ where: { userId: a.id, text: "A-SECRET fact" } })).toBe(1);
  });
});
