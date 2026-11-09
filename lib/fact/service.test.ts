import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/prisma";
import { getFact } from "@/lib/fact/service";
import type { FactWriter } from "@/lib/fact/writer";
import { cleanup, TEST_EMAIL_DOMAIN } from "@/tests/helpers/cleanup";

function fakeWriter(): FactWriter & { write: ReturnType<typeof vi.fn> } {
  let n = 0;
  return { write: vi.fn(async (title: string) => `Fact ${++n} about ${title}`) };
}

beforeAll(cleanup);
afterAll(async () => {
  await cleanup();
  await prisma.$disconnect();
});

describe("getFact", () => {
  it("generates and stores a fact, then serves it from cache", async () => {
    const user = await prisma.user.create({
      data: { email: `facts${TEST_EMAIL_DOMAIN}`, favoriteMovie: "Heat" },
    });
    const writer = fakeWriter();

    const first = await getFact(user.id, { db: prisma, writer });
    const second = await getFact(user.id, { db: prisma, writer });

    expect(first).toMatchObject({ kind: "ok", source: "generated", fact: { text: "Fact 1 about Heat" } });
    expect(second).toMatchObject({ kind: "ok", source: "cached", fact: { text: "Fact 1 about Heat" } });
    expect(writer.write).toHaveBeenCalledTimes(1);
    expect(writer.write).toHaveBeenCalledWith("Heat");

    const rows = await prisma.fact.findMany({ where: { userId: user.id } });
    expect(rows.map((r) => [r.movieTitle, r.text])).toEqual([["Heat", "Fact 1 about Heat"]]);
  });

  it("returns no-movie and skips the writer when the user has no favorite movie", async () => {
    const user = await prisma.user.create({ data: { email: `no-movie${TEST_EMAIL_DOMAIN}` } });
    const writer = fakeWriter();

    expect(await getFact(user.id, { db: prisma, writer })).toEqual({ kind: "no-movie" });
    expect(writer.write).not.toHaveBeenCalled();
    expect(await prisma.fact.count({ where: { userId: user.id } })).toBe(0);
  });
});

describe("Fact.createdAt", () => {
  it("uses clock_timestamp(), not the transaction's frozen now()", async () => {
    const user = await prisma.user.create({
      data: { email: `clock${TEST_EMAIL_DOMAIN}`, favoriteMovie: "Heat" },
    });

    const { txNow, createdAt } = await prisma.$transaction(
      async (tx) => {
        const [{ now }] = await tx.$queryRaw<{ now: Date }[]>`SELECT now() AS now`;
        await tx.$executeRaw`SELECT pg_sleep(2)`;
        const fact = await tx.fact.create({ data: { userId: user.id, movieTitle: "Heat", text: "t" } });
        return { txNow: now, createdAt: fact.createdAt };
      },
      { timeout: 15_000 },
    );

    expect(createdAt.getTime() - txNow.getTime()).toBeGreaterThanOrEqual(1900);
  });
});

describe("getFact cache window", () => {
  // Insert a Fact whose createdAt is `age` old.
  async function insertFact(userId: string, movieTitle: string, text: string, age: string) {
    await prisma.$executeRaw`
      INSERT INTO "Fact" ("id", "userId", "movieTitle", "text", "createdAt")
      VALUES (${`test-${crypto.randomUUID()}`}, ${userId}, ${movieTitle}, ${text}, clock_timestamp() - ${age}::interval)`;
  }

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
    expect(writer.write).toHaveBeenCalledWith("Heat");
  });
});
