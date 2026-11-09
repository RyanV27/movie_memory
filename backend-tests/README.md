# Backend tests

Two backend tests for the movie fact feature:

| File | What it proves |
|---|---|
| `cache-window.test.ts` | A fact under 60 seconds old is reused; at 60 seconds a new one is generated. |
| `authorization.test.ts` | A user can never fetch another user's facts. |

## How they work

Both tests run against the real Postgres dev database. Two things are faked:

- **OpenAI** is replaced by a fake writer, so no API key is needed and no money is spent.
- **Sign-in** (authorization test only) is replaced by a stub that says "the signed-in user is X", so no Google login is needed.

Everything else is the real code: the API route, the fact service and the SQL queries. That matters, because both the cache rule and the per-user rule live in the SQL `WHERE` clause.

Test users have emails ending in `@test.movie-memory.local` and are deleted before and after each file, so real data is never touched (see ADR 0002).

### 60-second cache (`cache-window.test.ts`)

Each test inserts a fact with a chosen age, calls `getFact`, and checks whether the writer was called:

- **59 seconds old** → returned as `cached`, writer not called.
- **60 seconds old** → too old, writer called, a new fact is stored.
- **Fresh fact added for a different movie** → ignored, because the cache is per movie as well as per user.

Ages are set with Postgres's `clock_timestamp()`, the same clock the service uses, so the 59 / 60 second boundary is exact.

### Authorization (`authorization.test.ts`)

1. Users A and B both have favorite movie "Heat", and each has a fresh fact.
2. A's fact ("A-SECRET fact") is inserted last, so it is the newest row for that movie.
3. Signed in as B, the test calls `GET /api/fact`.
4. It expects B's own fact, and the response must not contain "A-SECRET" anywhere.

The setup is chosen so the test fails if the query forgets to filter by user. With the same movie and A's fact newest, a query without `"userId" = ...` would return A's fact. The fake writer throws if called, so the answer must come from B's stored fact.

## Running them

Start Postgres first (the tests need the dev database):

```bash
npm run db:up
```

Run both tests:

```bash
npx vitest run backend-tests
```

Run one file:

```bash
npx vitest run backend-tests/authorization.test.ts
```

```bash
npx vitest run backend-tests/cache-window.test.ts
```

Watch mode reruns tests when you save a file (press `q` to quit):

```bash
npx vitest backend-tests
```

They also run as part of the full suite with `npm test`.

### See the authorization test fail

1. Start watch mode: `npx vitest backend-tests/authorization.test.ts`.
2. In `lib/fact/service.ts`, inside `freshFact`, delete `"userId" = ${userId} AND` and save.
3. The test fails with `expected 'A-SECRET fact' to be 'B-own fact'`: B was served A's fact.
4. Undo the edit (or `git checkout lib/fact/service.ts`). It passes again.
