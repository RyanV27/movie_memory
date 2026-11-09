# Movie Memory

Sign in with Google, save your favorite movie, and get a short AI-written fact about it on your dashboard.

Built with Next.js 16 (App Router), Auth.js v5, Prisma 7, PostgreSQL 17 and the OpenAI Responses API.

## Setup

**Prerequisites:** Node.js 20.19+ (developed on 22), Docker (for Postgres), a Google OAuth client and an OpenAI API key.

1. Install dependencies:

   ```bash
   npm install
   ```

2. Create your env file and fill it in (see [Environment variables](#environment-variables)):

   ```bash
   cp .env.example .env.local
   ```

3. Start Postgres (waits until the container is healthy):

   ```bash
   npm run db:up
   ```

4. Apply the migration and generate the Prisma client:

   ```bash
   npm run db:migrate
   ```

5. Start the app and open <http://localhost:3000>:

   ```bash
   npm run dev
   ```

**Google OAuth client:** in Google Cloud Console → APIs & Services → Credentials, create an "OAuth client ID" of type *Web application* with:

- Authorized JavaScript origin: `http://localhost:3000`
- Authorized redirect URI: `http://localhost:3000/api/auth/callback/google`

**Tests:** `npm test` runs the whole suite against the dev database (Postgres must be running). OpenAI is faked, so no API key is used and nothing is billed. See [`backend-tests/README.md`](backend-tests/README.md) for the cache and authorization tests.

**Stop Postgres:** `npm run db:down` (data is kept in the `movie_memory_data` Docker volume).

## Environment variables

All variables live in `.env.local` (git-ignored). Next.js reads it on its own; the Prisma CLI (`prisma.config.ts`) and Vitest (`vitest.config.ts`) load it explicitly, because Prisma 7 and Vitest don't read env files themselves.

| Variable | Required | What it is |
|---|---|---|
| `DATABASE_URL` | yes | Postgres connection string. The default in `.env.example` matches `docker-compose.yml`. |
| `AUTH_SECRET` | yes | Signs and encrypts Auth.js cookies. Generate with `npx auth secret` or `openssl rand -base64 32`. |
| `AUTH_GOOGLE_ID` | yes | Google OAuth client ID. |
| `AUTH_GOOGLE_SECRET` | yes | Google OAuth client secret. |
| `OPENAI_API_KEY` | yes | Used server-side only, to generate facts. Not needed for `npm test`. |
| `OPENAI_MODEL` | no | Model used for facts. Defaults to `gpt-6-luna`. |
| `AUTH_TRUST_HOST` | only for `npm start` | Set to `true` when running the production build locally. |

## Database migrations

The schema is in `prisma/schema.prisma`. There is one migration, `prisma/migrations/20261109095228_init`, which creates `User`, `Account`, `Session` and `Fact`.

**First run, or after pulling schema changes** (Postgres must be running):

```bash
npm run db:migrate
```

This runs `prisma migrate dev` (applies pending migrations), then `prisma generate` through the `postdb:migrate` hook. Prisma 7's `migrate dev` no longer generates the client, so the hook keeps `generated/prisma` in sync with the schema. Restart `npm run dev` afterwards: the dev server keeps the old client on `globalThis`.

**Other commands:**

- Check status: `npx prisma migrate status`
- Start over (deletes all data): `npx prisma migrate reset`

## Architecture

### Pages and redirects

Every page checks the session itself on the server; there is no middleware. The guards live in `lib/auth-guards.ts`.

| Visitor | `/` | `/onboarding` | `/dashboard` |
|---|---|---|---|
| Signed out | landing page | → `/` | → `/` |
| Signed in, no favorite movie | → `/onboarding` | movie form | → `/onboarding` |
| Signed in, has a movie | → `/dashboard` | → `/dashboard` | dashboard |

- **Sign-in** (`auth.ts`): Auth.js v5 with the Google provider, the Prisma adapter and **database sessions**. The cookie holds a random token that is looked up in `Session` on every request, so deleting the row ends the session at once.
- **Onboarding** (`app/onboarding/actions.ts`): a server action. The title is normalized (NFC, whitespace collapsed, trimmed) and validated with zod, 1–100 characters (`lib/movie-title.ts`). The save is one conditional update, so the favorite can't be changed later and two simultaneous submits can't both win.
- **Dashboard** (`app/dashboard/page.tsx`): a server component that renders the profile from the session (the name falls back to the part of the email before `@`; a missing or broken photo falls back to an icon) and a client `<FactCard />`. The page never waits for OpenAI.

### Fact pipeline

When the dashboard loads, the fact card (`components/fact-card.tsx`) calls `GET /api/fact` (`app/api/fact/route.ts`), which hands off to the fact service (`lib/fact/service.ts`). The service decides:

```text
1. Is there a fact for this movie from the last 60 seconds?  ── yes ──▶ return it
                              │ no
2. Is another request already generating one?   ── yes ──▶ return the previous fact; the card checks back shortly
                              │ no
3. Ask OpenAI for a new fact  ── ok ──▶ save it and return it
                              └─ fails or times out ──▶ return the previous fact, or a friendly error
```

- **Cache** (`lib/fact/service.ts`, `Fact` table in `prisma/schema.prisma`). Facts are stored in the database, and the latest one is reused for 60 seconds. The cache is per user and per movie.
- **One generation at a time** (`lib/fact/service.ts`, polling in `components/fact-card.tsx`). If several tabs or quick refreshes arrive together, only one request calls OpenAI. The others get the previous fact right away and the card polls until the new one is ready. The guard is a lock in Postgres, so it holds across multiple server instances.
- **Graceful failure** (`lib/fact/service.ts`, `app/api/fact/route.ts`). The OpenAI call has a 10-second timeout. If it fails, nothing is saved and the user sees their previous fact with a short note, or a friendly error if they have none. Error details stay in the server log.
- **OpenAI is swappable** (`lib/fact/writer.ts`, `lib/fact/openai-writer.ts`). The fact service talks to a small writer interface rather than to OpenAI directly, so tests use a fake writer and spend nothing.

### API responses (`GET /api/fact`)

| Status | Body | When |
|---|---|---|
| 200 | `{ fact, source: "generated" \| "cached" \| "stale" }` | a Fact is available |
| 202 | `{ pending: true, fact }` (`fact` may be `null`) | another request is generating; the client polls |
| 401 | `{ error }` | not signed in |
| 409 | `{ error }` | no favorite movie yet |
| 503 | `{ error }` | generation failed and there is no earlier Fact |

All responses send `Cache-Control: no-store`. The user id comes only from the session, and every Fact query filters by it.

### Data model

Four tables, defined in `prisma/schema.prisma`:

```text
User ─┬─< Account   (Google sign-in link)
      ├─< Session   (one row per signed-in browser)
      └─< Fact      (generated movie facts)
```

Every child row is deleted with its user (`ON DELETE CASCADE`).

**User**: one row per person. `Account` and `Session` are the standard Auth.js tables.

| Column | Type | Notes |
|---|---|---|
| `id` | text | primary key |
| `name`, `email`, `image` | text | from Google; `email` is unique |
| `emailVerified` | timestamp | Auth.js field |
| `favoriteMovie` | varchar(100) | `NULL` until onboarding; can't be changed once set |

**Fact**: one row per generated fact, also used as the 60-second cache.

| Column | Type | Notes |
|---|---|---|
| `id` | text | primary key |
| `userId` | text | owner, references `User` |
| `movieTitle` | varchar(100) | the movie the fact is about (a copy, so the fact always records it) |
| `text` | text | the fact |
| `createdAt` | timestamptz | set by the database when the row is inserted |

Index `(userId, movieTitle, createdAt DESC)` makes "this user's latest fact for this movie" a single index lookup.

### Code layout

```text
app/            pages, onboarding server action, /api/auth and /api/fact routes
components/     avatar, fact card, sign-out button
lib/            auth guards, title and name helpers, shared Prisma client
lib/fact/       fact service (cache, lock, fallback) and the OpenAI writer
prisma/         schema and migration
backend-tests/  60-second cache and authorization tests
test_helpers/   test-user cleanup and the Vitest global setup
```

### Tests

Vitest runs against the real dev database, one file at a time. Test users have emails ending in `@test.movie-memory.local` and are deleted before every run and after each file; OpenAI and, where needed, the session are faked.

## Variant choice: A

The riskiest part of this application is the OpenAI call: it's slow, it can fail, and it costs money each time. Without protection, a user refreshing quickly or opening several tabs triggers duplicate generations, and an OpenAI outage breaks the dashboard entirely. Variant A addresses those problems directly, so I chose it as the more valuable place to spend limited time.

It also reflects the kind of work I'd expect in production systems that integrate with third-party APIs: handling timeouts, falling back gracefully, and making sure concurrent requests don't create duplicate work. That matters even more on serverless infrastructure, where requests run on separate instances that share no memory.

In practice that meant:

- a 60-second cache keyed on user + movie, judged on the database clock;
- a Postgres advisory lock, so a burst of requests produces one OpenAI call, even across instances;
- a 10-second timeout with a fallback to the last fact, so an outage degrades the dashboard instead of breaking it;
- backend tests for the cache window and for cross-user authorization.

## Key tradeoffs

- **Try-lock and polling instead of a blocking lock.** A blocking lock (`pg_advisory_xact_lock`) would be simpler for the client, since every tab gets the new fact in one response, but each waiting tab would hold a database connection for the whole OpenAI call, and a handful of tabs could drain the pool. With `pg_try_advisory_xact_lock`, the other requests return in milliseconds. Cost: the client handles a `pending` state and polls, and if the generating request's OpenAI call fails, a polling request can take the now-free lock and try again (an implicit retry, bounded by the poll cap). The poll budget (10 × 1.5 s) must stay longer than the OpenAI timeout (10 s).
- **Database sessions instead of JWT.** The cookie is only a random token, so deleting the `Session` row signs that browser out on its next request. A JWT stays valid until it expires, unless you rotate the secret (signing everyone out) or keep a revocation list. Cost: one `Session` + `User` query on every request, which also hands the guards `favoriteMovie` for free.
- **No middleware; each page calls a guard.** With database sessions, middleware could only see that a cookie exists, not that it's valid, so it would duplicate part of the page checks. Server-side guards give real 307 redirects before any HTML is sent. Cost: every new page must remember to call `requireUser()` or `requireOnboarded()`. Middleware becomes worth it with many routes, or for headers and rate limiting.

## With 2 more hours

- **Circuit breaker for OpenAI failures.** Failures aren't cached today, so during an outage every dashboard load calls OpenAI again (twice, counting the retry from a polling request). I'd record recent failures and, for a short cooldown, serve the stale fact straight away without calling OpenAI.
- **Avoid near-duplicate facts.** The cache controls *when* we call OpenAI, not *what* it says, and the model repeats the same trivia in different words. I'd pass the user's last few facts for that movie into the prompt and ask for something new.
- **Trim the error logs.** On failure the server logs the full OpenAI error object (headers, request id). OpenAI masks the key, but I'd log only the status, error code and request id.

## AI usage

- Used Claude Code throughout, working in vertical slices. I wrote specs and tickets first and recorded the bigger design decisions as decision records before writing code.
- Each slice was implemented with Claude. I answered check questions on the decisions, ran a hands-on demo, and ran a "break it" experiment to make sure I understood and could explain every piece.
- Backend tests were written test-first where it mattered (cache window, timeouts, burst guard).
- I made the final calls on tradeoffs and scope, and overrode the AI's suggestions in places.
- In spite of verification done by the AI agents, manual demos caught bugs the AI and the unit tests missed.
