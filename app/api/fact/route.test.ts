import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/prisma";
import { cleanup, TEST_EMAIL_DOMAIN } from "@/test_helpers/cleanup";
import { GET } from "./route";

// Signed-in user id the mocked auth() returns.
const session = vi.hoisted(() => ({ userId: "" }));

vi.mock("@/auth", () => ({
  auth: async () => ({ user: { id: session.userId } }),
}));

// Writer that fails with provider-like secret text.
vi.mock("@/lib/fact/openai-writer", () => ({
  createOpenAIFactWriter: () => ({
    write: async () => {
      throw new Error("401 Incorrect API key provided: sk-test-SECRET123");
    },
  }),
}));

beforeAll(async () => {
  await cleanup();
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterAll(async () => {
  vi.restoreAllMocks();
  await cleanup();
  await prisma.$disconnect();
});

describe("GET /api/fact when the AI fails", () => {
  it("returns 503 with only a friendly message when there is no fact", async () => {
    const user = await prisma.user.create({
      data: { email: `route-fail${TEST_EMAIL_DOMAIN}`, favoriteMovie: "Heat" },
    });
    session.userId = user.id;

    const res = await GET();
    const text = await res.text();

    expect(res.status).toBe(503);
    expect(JSON.parse(text)).toEqual({ error: "Couldn't get a movie fact right now." });
    for (const leak of ["sk-", "SECRET", "stack", "Error:"]) expect(text).not.toContain(leak);
    expect(await prisma.fact.count({ where: { userId: user.id } })).toBe(0);
  });

  it("returns 200 with the older fact as stale", async () => {
    const user = await prisma.user.create({
      data: { email: `route-stale${TEST_EMAIL_DOMAIN}`, favoriteMovie: "Heat" },
    });
    await prisma.$executeRaw`
      INSERT INTO "Fact" ("id", "userId", "movieTitle", "text", "createdAt")
      VALUES (${`test-${crypto.randomUUID()}`}, ${user.id}, 'Heat', 'Old fact', clock_timestamp() - interval '5 minutes')`;
    session.userId = user.id;

    const res = await GET();
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toMatchObject({ source: "stale", fact: { text: "Old fact" } });
  });
});
