# ilab-cfs

Innovation Lab @ NTU CCDS call for speakers platform — one place where speakers pitch talks for TechTalks, DevHub workshops and Catalyst sharing sessions, organizers review them, and outcomes get tracked and sent.

Astro 7 on Cloudflare Workers · D1 (Drizzle) · R2 · KV · Better Auth · Resend.

> **Status:** early. Authentication works end to end; the application tables and essentially every screen are still to be built. `docs/intent.md` is the source of truth for what this is and why it is shaped this way — read it before designing anything.

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

There is no `/sign-in` page yet, so the flow is driven by hand for now. Sign-in is passwordless — a magic link, or OAuth once credentials are configured.

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
- **After adding a variable to `.dev.vars`, re-run `pnpm generate-types`.** Worker env types are generated from that file, so a missing entry shows up as a type error where you use it.
- **A new page behind auth needs `export const prerender = false`.** Astro is static by default here; without it the page ships as a build-time snapshot instead of running per request.
- If you run the server with `--background`, its output goes to `astro dev logs --follow` rather than your terminal. Astro may also background it automatically inside AI-agent environments, where a *"failed to start within 30s"* message usually just means the slow first start is still in progress.

## Before the first deploy

Not done yet, and each step needs someone with access to the lab's accounts:

1. `wrangler d1 create ilab-cfs` and `wrangler kv namespace create AUTH_KV`, then replace the placeholder ids in `wrangler.jsonc`.
2. `wrangler secret put BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`, `RESEND_API_KEY`.
3. Register the Google / GitHub / LinkedIn OAuth apps. Each provider stays switched off until both halves of its credential pair are set, so they can be added one at a time.
4. Verify the `ilabccds.com` sending domain in Resend. Mail goes out as `no-reply@ilabccds.com` and nobody reads replies.
5. `pnpm db:migrate:remote`.

## Further reading

- `docs/intent.md` — what the platform does, and what was deliberately left out
- `docs/db/` — every table and an ER diagram. Generated by `pnpm docs:db`; don't hand-edit, and regenerate it alongside any schema change
- `CLAUDE.md` — working notes, and the traps verified against the shipped packages
