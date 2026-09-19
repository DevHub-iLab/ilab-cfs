# ilab-cfs

Innovation Lab @ NTU CCDS call for speakers platform — one place where speakers pitch talks for TechTalks, DevHub workshops and Catalyst sharing sessions, organizers review them, and outcomes get tracked and sent.

Astro 7 on Cloudflare Workers · D1 (Drizzle) · R2 · KV · Better Auth · Resend.

> **Status:** early, but the speaker's half works. Someone can sign in, write a pitch, submit it, keep editing it and withdraw it. Nobody can answer them yet — the reviewer and admin screens, and the `event` and `review` tables behind them, are still to be built. `docs/intent.md` is the source of truth for what this is and why it is shaped this way — read it before designing anything.

## Prerequisites

- Node 22.12+
- pnpm 12 (`corepack enable` picks up the pinned version) — **not npm**, the lockfile is `pnpm-lock.yaml`

No Cloudflare account or login is needed for local development. Wrangler emulates D1 and KV on disk under `.wrangler/state/`, which is why the placeholder resource ids in `wrangler.jsonc` don't matter until you deploy.

## Setup

```bash
pnpm install
cp .dev.vars.example .dev.vars
openssl rand -base64 32          # paste into BETTER_AUTH_SECRET in .dev.vars
pnpm db:migrate:local            # creates the auth tables in the local D1
```

`.dev.vars` holds local secrets and is gitignored. Leaving `RESEND_API_KEY` empty is the normal local setup — see below.

## Running

```bash
pnpm dev
```

Then open <http://localhost:4321>.

The first start takes a couple of minutes while Vite pre-bundles dependencies; later ones are quick.

## Signing in locally

Sign-in is passwordless — a magic link, or OAuth once credentials are configured — and `/sign-in` does all of it in a browser. The rest of this section is for driving it by hand, which is quicker when you just need a session.

Request a link:

```bash
curl -s -X POST http://localhost:4321/api/auth/sign-in/magic-link \
  -H 'Content-Type: application/json' \
  -H 'Origin: http://localhost:4321' \
  -d '{"email":"you@example.com"}'
```

The `Origin` header is required: Better Auth rejects state-changing requests without one. That is CSRF protection working, not a bug — don't disable it.

With no `RESEND_API_KEY` set, **the magic link prints to your terminal** instead of being emailed. Open that URL in a browser and you are signed in, with the session cookie set. To check:

```
http://localhost:4321/api/auth/get-session
```

New accounts are always created as `speaker`; the role cannot be set from the sign-up request. Roles are granted by an admin, and there is no UI for that yet, so promote yourself directly:

```bash
pnpm exec wrangler d1 execute ilab-cfs --local \
  --command "UPDATE user SET role='admin' WHERE email='you@example.com';"
```

Access is enforced in middleware by route prefix (`/admin` needs admin, `/review` needs reviewer, `/proposals` and `/account` need any signed-in user), so a new page under one of those is protected the moment it is created. Signed out you get redirected to `/sign-in`; signed in without the role you get a 403. A 404 means the guard let you through and the page simply doesn't exist yet.

## Seeing an open call locally

The landing page renders whatever `cfp` rows are open — `closes_at IS NULL` for a
continuous call, a future `closes_at` for an event-specific one. A fresh database
has none, so the page correctly shows its empty state. There is no admin UI for
creating calls yet, so seed a few by hand:

```bash
pnpm exec wrangler d1 execute ilab-cfs --local --command "
INSERT INTO cfp (id, name, track, description, closes_at) VALUES
 ('techtalk-oct', 'October TechTalk', 'techtalks', 'Three 25-minute slots.', unixepoch('now','+18 days') * 1000),
 ('devhub', 'Hands-on workshops, any month', 'devhub', 'A continuous call — no deadline.', NULL),
 ('catalyst', 'Senior sharing sessions', 'catalyst', 'Final-years and alumni, for juniors.', NULL);
"
```

`track` is one of `techtalks`, `devhub`, `catalyst`. Closing a call is setting
`closes_at` to a past instant — there is no status column, and the page's filter
is the same predicate the submission guard runs.

## Poking at the data

```bash
pnpm exec wrangler d1 execute ilab-cfs --local --command "SELECT email, role FROM user;"
pnpm exec wrangler kv key list --binding AUTH_KV --local
```

D1 is the system of record. KV only caches sessions and is never authoritative — every value in it is reconstructible from D1, so deleting a key is safe.

## Commands

| Command | Does |
| --- | --- |
| `pnpm dev` | Dev server |
| `pnpm build` / `pnpm preview` | Production build / preview it |
| `pnpm auth:generate` | Better Auth CLI → `src/db/auth-schema.ts` |
| `pnpm db:generate` | drizzle-kit → a new file in `migrations/` |
| `pnpm db:migrate:local` | Apply migrations locally |
| `pnpm db:migrate:remote` | Apply them to the deployed database |
| `pnpm docs:db` | Regenerate `docs/db/` from the schema |
| `pnpm generate-types` | `wrangler types` → `worker-configuration.d.ts` |

Changing the auth config goes `auth:generate` → **review the diff** → `db:generate` → `db:migrate:*` → `docs:db`. Migrations are only ever applied with `wrangler d1 migrations apply`; never run `drizzle-kit push` against a deployed database.

## Gotchas

- **Restart the dev server after editing `wrangler.jsonc`, `.dev.vars`, or `astro.config.mjs`.** Bindings and secrets are read at startup and are not hot-reloaded.
- **Changing `database_id` resets your local database.** Wrangler names the local SQLite file after that id, so editing it points local dev at a fresh empty one. Pages still render and only the first query fails, with a confusing `Failed query: select … from "rate_limit"`. Fix: `pnpm db:migrate:local`.
- **After adding a variable to `.dev.vars`, re-run `pnpm generate-types`.** Worker env types are generated from that file, so a missing entry shows up as a type error where you use it.
- **A new page behind auth needs `export const prerender = false`.** Astro is static by default here; without it the page ships as a build-time snapshot instead of running per request.
- If you run the server with `--background`, its output goes to `astro dev logs --follow` rather than your terminal. Astro may also background it automatically inside AI-agent environments, where a *"failed to start within 30s"* message usually just means the slow first start is still in progress.

## Before the first deploy

The D1 database and KV namespace exist and their ids are in `wrangler.jsonc`, as is the production origin. What's left needs someone with access to the lab's accounts:

1. **Secrets.** `wrangler secret put BETTER_AUTH_SECRET` (32+ chars) and `wrangler secret put RESEND_API_KEY`.

   The first one asks *"There doesn't seem to be a Worker called ilab-cfs — create it?"*. **Say yes.** It uploads a no-op placeholder Worker purely to hold the secrets, which `wrangler deploy` then replaces. Setting secrets first is the right order: deploying before them puts the site live with `BETTER_AUTH_SECRET` undefined.

   `BETTER_AUTH_URL` is *not* a secret — it is a `var` in `wrangler.jsonc`, next to the route it has to match.

2. **OAuth apps.** Register each provider with the redirect URI for its id:

   ```
   https://cfs.ilabccds.com/api/auth/callback/google
   https://cfs.ilabccds.com/api/auth/callback/github
   https://cfs.ilabccds.com/api/auth/callback/linkedin
   ```

   Then `wrangler secret put GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, and so on. A provider stays switched off until both halves of its pair are set, so they can be added one at a time. A mismatched redirect URI is the usual first failure, and the error comes from the provider rather than from here.

3. **Resend.** Verify the `ilabccds.com` sending domain — its DNS is already on Cloudflare, so the records are self-serve. Mail goes out as `no-reply@ilabccds.com` and nobody reads replies.

4. `pnpm db:migrate:remote`

5. `wrangler deploy` — the site is then served at <https://cfs.ilabccds.com>, and wrangler creates that DNS record itself.

Changing the domain means changing three things together: the `routes` pattern, `BETTER_AUTH_URL`, and every registered OAuth redirect URI.

## Further reading

- `docs/intent.md` — what the platform does, and what was deliberately left out
- `docs/db/` — every table and an ER diagram. Generated by `pnpm docs:db`; don't hand-edit, and regenerate it alongside any schema change
- `CLAUDE.md` — working notes, and the traps verified against the shipped packages
