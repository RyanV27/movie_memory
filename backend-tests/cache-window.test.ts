import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/prisma";
import { getFact } from "@/lib/fact/service";
import type { FactWriter } from "@/lib/fact/writer";
import { cleanup, TEST_EMAIL_DOMAIN } from "@/tests/helpers/cleanup";

function fakeWriter(): FactWriter & { write: ReturnType<typeof vi.fn> } {
  let n = 0;
  return { write: vi.fn(async (title: string) => `Fact ${++n} about ${title}`) };
}

// Insert a Fact whose createdAt is `age` old.
async function insertFact(userId: string, movieTitle: string, text: string, age: string) {
  await prisma.$executeRaw`
    INSERT INTO "Fact" ("id", "userId", "movieTitle", "text", "createdAt")
    VALUES (${`test-${crypto.randomUUID()}`}, ${userId}, ${movieTitle}, ${text}, clock_timestamp() - ${age}::interval)`;
}

beforeAll(cleanup);
afterAll(async () => {
  await cleanup();
  await prisma.$disconnect();
});

describe("getFact cache window", () => {
  it("returns a 59-second-old fact as cached without calling the writer", async () => {
    const user = await prisma.user.create({
      data: { email: `cache-59${TEST_EMAIL_DOMAIN}`, favoriteMovie: "Heat" },
    });
    await insertFact(user.id, "Heat", "Old fact", "59 seconds");
    const writer = fakeWriter();

    const result = await getFact(user.id, { db: prisma, writer });

    expect(result).toMatchObject({ kind: "ok", source: "cached", fact: { text: "Old fact" } });
    expect(writer.write).not.toHaveBeenCalled();
    expect(await prisma.fact.count({ where: { userId: user.id } })).toBe(1);
  });

  it("generates a new fact when the latest is 60 seconds old", async () => {
    const user = await prisma.user.create({
      data: { email: `cache-60${TEST_EMAIL_DOMAIN}`, favoriteMovie: "Heat" },
    });
    await insertFact(user.id, "Heat", "Stale fact", "60 seconds");
    const writer = fakeWriter();

    const result = await getFact(user.id, { db: prisma, writer });

    expect(result).toMatchObject({ kind: "ok", source: "generated", fact: { text: "Fact 1 about Heat" } });
    expect(writer.write).toHaveBeenCalledTimes(1);
    expect(await prisma.fact.count({ where: { userId: user.id } })).toBe(2);
  });

  it("does not return a fresh fact for a different movie", async () => {
    const user = await prisma.user.create({
      data: { email: `cache-movie${TEST_EMAIL_DOMAIN}`, favoriteMovie: "Heat" },
    });
    await insertFact(user.id, "Alien", "Alien fact", "5 seconds");
    const writer = fakeWriter();

    const result = await getFact(user.id, { db: prisma, writer });

    expect(result).toMatchObject({ kind: "ok", source: "generated", fact: { text: "Fact 1 about Heat" } });
    expect(writer.write).toHaveBeenCalledTimes(1);
    expect(writer.write).toHaveBeenCalledWith("Heat", expect.any(AbortSignal));
  });
});
