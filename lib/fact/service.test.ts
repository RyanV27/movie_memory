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
    expect(writer.write).toHaveBeenCalledWith("Heat", expect.any(AbortSignal));

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

describe("getFact burst guard", () => {
  // Writer whose calls wait until the test calls release().
  function gatedWriter() {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    let n = 0;
    const write = vi.fn(async (title: string) => {
      const id = ++n;
      await gate;
      return `Fact ${id} about ${title}`;
    });
    return { writer: { write } as FactWriter & { write: typeof write }, release };
  }

  // Runs calls in the background and records each result as it settles.
  function track<T>(promises: Promise<T>[]) {
    const settled: T[] = [];
    for (const p of promises) p.then((r) => settled.push(r), () => {});
    return settled;
  }

  it("lets one of two concurrent calls generate and answers the other with pending", async () => {
    const user = await prisma.user.create({
      data: { email: `burst${TEST_EMAIL_DOMAIN}`, favoriteMovie: "Heat" },
    });
    const { writer, release } = gatedWriter();

    const calls = [getFact(user.id, { db: prisma, writer }), getFact(user.id, { db: prisma, writer })];
    const settled = track(calls);
    // The loser answers while the winner is still waiting on the writer.
    await vi.waitFor(() => expect(settled).toHaveLength(1), { timeout: 3000 });
    expect(settled[0]).toEqual({ kind: "pending", fact: null });

    release();
    const results = await Promise.all(calls);

    expect(results.filter((r) => r.kind === "pending")).toHaveLength(1);
    expect(results.filter((r) => r.kind === "ok" && r.source === "generated")).toHaveLength(1);
    expect(writer.write).toHaveBeenCalledTimes(1);
    expect(await prisma.fact.count({ where: { userId: user.id } })).toBe(1);

    // The winner's fact is now fresh, so the next call is cached.
    const next = await getFact(user.id, { db: prisma, writer });
    expect(next).toMatchObject({ kind: "ok", source: "cached", fact: { text: "Fact 1 about Heat" } });
    expect(writer.write).toHaveBeenCalledTimes(1);
  });

  it("returns the latest stale fact with pending", async () => {
    const user = await prisma.user.create({
      data: { email: `burst-stale${TEST_EMAIL_DOMAIN}`, favoriteMovie: "Heat" },
    });
    await prisma.$executeRaw`
      INSERT INTO "Fact" ("id", "userId", "movieTitle", "text", "createdAt")
      VALUES (${`test-${crypto.randomUUID()}`}, ${user.id}, 'Heat', 'Old fact', clock_timestamp() - interval '5 minutes')`;
    const { writer, release } = gatedWriter();

    const calls = [getFact(user.id, { db: prisma, writer }), getFact(user.id, { db: prisma, writer })];
    const settled = track(calls);
    await vi.waitFor(() => expect(settled).toHaveLength(1), { timeout: 3000 });
    expect(settled[0]).toMatchObject({ kind: "pending", fact: { text: "Old fact" } });

    release();
    await Promise.all(calls);
    expect(writer.write).toHaveBeenCalledTimes(1);
  });

  it("does not block different users", async () => {
    const [a, b] = await Promise.all(
      ["burst-a", "burst-b"].map((name) =>
        prisma.user.create({ data: { email: `${name}${TEST_EMAIL_DOMAIN}`, favoriteMovie: "Heat" } }),
      ),
    );
    const { writer, release } = gatedWriter();

    const calls = [getFact(a.id, { db: prisma, writer }), getFact(b.id, { db: prisma, writer })];
    // Both reach the writer at once, so neither waited on the other's lock.
    await vi.waitFor(() => expect(writer.write).toHaveBeenCalledTimes(2), { timeout: 3000 });
    release();
    const results = await Promise.all(calls);

    expect(results.map((r) => r.kind === "ok" && r.source)).toEqual(["generated", "generated"]);
    expect(await prisma.fact.count({ where: { userId: a.id } })).toBe(1);
    expect(await prisma.fact.count({ where: { userId: b.id } })).toBe(1);
  });

  it("re-checks freshness after the lock on the live clock, not the transaction's now()", async () => {
    const user = await prisma.user.create({
      data: { email: `burst-clock${TEST_EMAIL_DOMAIN}`, favoriteMovie: "Heat" },
    });
    const writer = fakeWriter();
    // Before the service's own work in its transaction: commit a fact 59s old, then wait 2s.
    // Fresh against the frozen now() (tx start), stale against clock_timestamp() at re-check.
    const db = new Proxy(prisma, {
      get(target, prop) {
        if (prop === "$transaction") {
          return (fn: (tx: unknown) => Promise<unknown>, opts: object) =>
            target.$transaction(async (tx) => {
              await tx.$queryRaw`SELECT now()`;
              await prisma.$executeRaw`
                INSERT INTO "Fact" ("id", "userId", "movieTitle", "text", "createdAt")
                VALUES (${`test-${crypto.randomUUID()}`}, ${user.id}, 'Heat', 'Almost stale', clock_timestamp() - interval '59 seconds')`;
              await tx.$executeRaw`SELECT pg_sleep(2)`;
              return fn(tx);
            }, opts);
        }
        const value = Reflect.get(target, prop, target);
        return typeof value === "function" ? value.bind(target) : value;
      },
    });

    const result = await getFact(user.id, { db, writer });

    expect(result).toMatchObject({ kind: "ok", source: "generated", fact: { text: "Fact 1 about Heat" } });
    expect(writer.write).toHaveBeenCalledTimes(1);
  });
});

describe("getFact failure handling", () => {
  // Writer that always rejects with a provider-like error.
  function failingWriter() {
    return { write: vi.fn(async () => Promise.reject(new Error("OpenAI 500: upstream failure"))) };
  }

  // Writer that never settles and ignores the signal; records the signal it was given.
  function hangingWriter() {
    const signals: (AbortSignal | undefined)[] = [];
    const write = vi.fn((_title: string, signal?: AbortSignal) => {
      signals.push(signal);
      return new Promise<string>(() => {});
    });
    return { writer: { write } as FactWriter & { write: typeof write }, signals };
  }

  beforeAll(() => {
    vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterAll(() => {
    vi.restoreAllMocks();
  });

  it("returns the older fact as stale when the writer throws", async () => {
    const user = await prisma.user.create({
      data: { email: `fail-stale${TEST_EMAIL_DOMAIN}`, favoriteMovie: "Heat" },
    });
    await insertFact(user.id, "Heat", "Old fact", "5 minutes");
    const writer = failingWriter();

    const result = await getFact(user.id, { db: prisma, writer });

    expect(result).toMatchObject({ kind: "ok", source: "stale", fact: { text: "Old fact" } });
    expect(writer.write).toHaveBeenCalledTimes(1);
    expect(await prisma.fact.count({ where: { userId: user.id } })).toBe(1);
  });

  it("returns failed and stores nothing when the writer throws and there is no fact", async () => {
    const user = await prisma.user.create({
      data: { email: `fail-none${TEST_EMAIL_DOMAIN}`, favoriteMovie: "Heat" },
    });
    const writer = failingWriter();

    const result = await getFact(user.id, { db: prisma, writer });

    expect(result).toEqual({ kind: "failed" });
    expect(await prisma.fact.count({ where: { userId: user.id } })).toBe(0);
  });

  it("treats a writer that hangs past the timeout as failed", async () => {
    const user = await prisma.user.create({
      data: { email: `hang-none${TEST_EMAIL_DOMAIN}`, favoriteMovie: "Heat" },
    });
    const { writer } = hangingWriter();

    const started = Date.now();
    const result = await getFact(user.id, { db: prisma, writer, aiTimeoutMs: 50 });

    expect(result).toEqual({ kind: "failed" });
    expect(Date.now() - started).toBeLessThan(3000);
    expect(await prisma.fact.count({ where: { userId: user.id } })).toBe(0);
  });

  it("returns the older fact as stale when the writer hangs past the timeout", async () => {
    const user = await prisma.user.create({
      data: { email: `hang-stale${TEST_EMAIL_DOMAIN}`, favoriteMovie: "Heat" },
    });
    await insertFact(user.id, "Heat", "Old fact", "5 minutes");
    const { writer } = hangingWriter();

    const result = await getFact(user.id, { db: prisma, writer, aiTimeoutMs: 50 });

    expect(result).toMatchObject({ kind: "ok", source: "stale", fact: { text: "Old fact" } });
    expect(await prisma.fact.count({ where: { userId: user.id } })).toBe(1);
  });

  it("aborts the writer's signal when the timeout fires", async () => {
    const user = await prisma.user.create({
      data: { email: `hang-signal${TEST_EMAIL_DOMAIN}`, favoriteMovie: "Heat" },
    });
    const { writer, signals } = hangingWriter();

    await getFact(user.id, { db: prisma, writer, aiTimeoutMs: 50 });

    expect(signals).toHaveLength(1);
    expect(signals[0]).toBeInstanceOf(AbortSignal);
    expect(signals[0]?.aborted).toBe(true);
  });
});
