# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

`ilab-cfs` — a call-for-speakers platform for Innovation Lab @ NTU CCDS (`DevHub-iLab/ilab-cfs`), covering TechTalks, DevHub workshops, and Catalyst sharing sessions.

**`docs/intent.md` is the source of truth for product and architecture decisions.** Read it before designing anything. It records not just what was decided but what was deliberately left out and why — several absences there (no `waitlisted` status, no cron, no conflict-of-interest check) are decisions, not gaps to close.

## Commands

**pnpm, not npm** — the lockfile is `pnpm-lock.yaml`.

```
pnpm install
pnpm dev        # astro dev — use `pnpm astro dev --background`, then `astro dev stop|status|logs`
pnpm build      # astro build
pnpm preview    # astro preview

pnpm auth:generate      # Better Auth CLI -> src/db/auth-schema.ts (see auth.config.ts)
pnpm db:generate        # drizzle-kit generate -> migrations/
pnpm db:migrate:local   # wrangler d1 migrations apply --local
pnpm db:migrate:remote  # the same, deployed
pnpm docs:db            # drizzle-docs-generator -> docs/db (tables + ER diagram)
pnpm generate-types     # wrangler types -> worker-configuration.d.ts
```

The auth order is `auth:generate` → review the diff → `db:generate` → `db:migrate:*` → `docs:db`.

**Changing `database_id` in `wrangler.jsonc` silently resets the local database.** Miniflare names the local SQLite file by hashing that id, so editing it — pasting a real id over a placeholder, or pointing at another database — leaves local dev talking to a brand new empty one while the old file sits beside it. Nothing warns you: pages render fine and only the first query fails, as `Failed query: select ... from "rate_limit"` or similar. Re-run `pnpm db:migrate:local`.

`docs/db/` is **generated** — never hand-edit it. It is derived from `src/db/schema.ts`, not from a live database, so it needs no binding and regenerates offline; re-run `docs:db` in the same commit as any schema change or it silently goes stale. `drizzle-docs-generator` is pinned exactly because its output format, not just the schema, decides the diff. Note its bin is named `drizzle-docs` — that mismatch is why `npx drizzle-docs` works while `npm view drizzle-docs` 404s. **It cannot be run with `pnpm dlx`**: it pulls `esbuild`, whose build script pnpm blocks outside the workspace allowlist, so it is a devDependency rather than a one-off. Re-run `generate-types` after editing `wrangler.jsonc` **or `.dev.vars`** — secrets are typed onto `Env` from the latter, so a var missing there is a type error at its use site.

Astro detects an agent environment and always backgrounds the dev server, so `--ignore-lock` is rejected and plain `pnpm dev` returns immediately. Cold start takes ~2 minutes, well past the CLI's own 30s watchdog: **"Dev server failed to start within 30s" is usually a slow start, not a failure.** Poll the port, or `astro dev logs`, before believing it.

**`pnpm build` breaks a dev server that is already running.** The build clears `node_modules/.vite/deps_ssr`, which the running server still holds open, and every request afterwards 500s with `The file does not exist at ".../deps_ssr/astro_app_entrypoint_dev.js?v=…" which is in the optimize deps directory`. It reads like a code error and is not one — the fix is `astro dev stop` and start again. **Ignore the message's own advice to add the dependency to `optimizeDeps.exclude`**; nothing is wrong with the dependency.

No test runner is set up yet; add one and document it here when the first test lands.

Two pnpm details that will otherwise waste your time:

- **Build scripts are blocked by default.** `esbuild` and `workerd` need theirs to fetch native binaries; they're allowlisted in `pnpm-workspace.yaml` under `onlyBuiltDependencies` (pnpm 12 no longer reads the `pnpm` key in `package.json`). A new dependency needing a postinstall goes there too, via `pnpm approve-builds`.
- **A supply-chain policy rejects packages published within the last 24 hours.** `wrangler` is pinned to an exact `4.131.0` for that reason. When bumping, pick a release older than a day rather than relaxing the policy.

## Current state

Built: Astro + Cloudflare adapter + Tailwind 4 with the Nocturne layer, authentication end to end (D1 + KV bindings, Better Auth with magic link, OAuth, roles and middleware, and the Resend send function), the `cfp`, `proposal` and `proposal_revision` tables, and the speaker's half of the product — `/sign-in`, the homepage, `/proposals`, `/proposals/new` and the proposal editor at `/proposals/<id>`, with sign-out. On the admin side, `/admin/calls` opens and closes calls.

A speaker can sign in, write a pitch, submit it, keep editing it, withdraw it and delete a draft, and an admin decides what there is to pitch to. Nobody can answer them yet.

Not yet built: the R2 binding, the `event`, `review`, `attachment`, `audit_log` and `notification` tables, every reviewer screen, and the rest of the admin console — deciding, scheduling and the two chase lists of artboard 1f. `/review`, `/schedule`, `/archive`, `/code-of-conduct` and a call's own page are all linked to and all 404; `/review` is guarded by prefix, so a signed-out visitor is redirected to sign-in and only then meets the 404. `/admin` itself redirects to `/admin/calls`, which is the only admin screen there is.

**Calls are opened and closed at `/admin/calls`** — the screen that stood between the lab and using any of this, since with no `cfp` row the homepage shows its empty state and `/proposals/new` has nothing to submit to. It has no design of its own: artboard 1f draws the console's nav with a *Calls* link and never the screen behind it, so this is built in the same language rather than from a picture.

Getting the first admin is still a hand-written `UPDATE user SET role='admin'` — roles cannot be self-declared, and there is no screen for granting them. The README has that line, and keeps the seeding SQL for a database with no admin in it yet.

**Closing is `UPDATE cfp SET closes_at = now` and nothing else.** There is no status column and `src/lib/calls.ts` explains why one would only disagree with the deadline beside it. Two things in there are easy to get wrong from memory: the guard `closes_at is null or closes_at > now` is what stops a double-submitted form rewriting when a call shut, and a `datetime-local` posts a bare wall clock, so the `+08:00` is what keeps a deadline typed as 11:59pm from being stored as 7:59am SGT on a Worker whose local zone is UTC.

Two screens are built from the design canvas minus what they cannot read. The homepage (artboard 4a) omits four bands that need `event` and `proposal` aggregates: the hero's proposal count, the stat band, "Next up" and "Recently on stage". The speaker's list (1d) omits the scheduled talk's card and its deck ask, the comment counts, and the reviewer's line on a rejected pitch. All were left out rather than filled with the design's sample figures, which would state invented numbers as fact. Each is a self-contained addition once the tables exist.

The submit editor (1c) has no autosave and no deck upload — the first needs a decision about how often to write revisions, the second needs R2.

**`src/lib/proposals.ts` is where the invariants live.** Every write is one guarded statement plus an assertion on `meta.changes`, never a read-then-write, because D1 has no interactive transactions. Read the module comment before changing it: it says which statements are Drizzle builders, which two are `sql` templates and why, and how `statement()` lowers either kind so they can share one `env.DB.batch()`.

Auth is verified working against local D1 + KV: magic link issued and consumed, session minted, role enforced, and a session surviving a KV miss by falling back to D1.

The D1 database and KV namespace exist, and `wrangler.jsonc` carries their real ids — local development uses neither, since wrangler emulates both from `.wrangler/state/`. Production is served from `cfs.ilabccds.com` via a `custom_domain` route, with `BETTER_AUTH_URL` set as a **var beside it rather than a secret**: it is public, and keeping the two adjacent is what stops the origin and the route drifting apart. Still outstanding before a deploy: the `BETTER_AUTH_SECRET` and `RESEND_API_KEY` secrets, the OAuth apps, and `db:migrate:remote` — see the README's deploy checklist.

**The origin is load-bearing in three places at once** — the `routes` pattern, `BETTER_AUTH_URL`, and every OAuth redirect URI (`<origin>/api/auth/callback/<provider>`). Change one and change all three.

## Stack

Astro 7 on Cloudflare Workers · D1 (Drizzle) · R2 · KV · Better Auth · Resend.

Installed 2026-09-12: `astro@7.3.2`, `@astrojs/cloudflare@14.3.1`, `tailwindcss@4.3.3` (via `@tailwindcss/vite`), `wrangler@4.131.0` (pinned), `drizzle-orm@0.45.2`, `drizzle-kit@0.31.10`, `better-auth@1.7.4`, `@better-auth/drizzle-adapter@1.7.4`.

Better Auth landed on 1.7.4 rather than the 1.7.2 planned in `docs/intent.md` — same minor, published well outside the 24-hour supply-chain window, and `@better-auth/drizzle-adapter` peer-requires exactly the `drizzle-orm@^0.45.2` already pinned. The `auth` CLI is run via `pnpm dlx auth@1.7.4` rather than installed; **keep that version in step with `better-auth`** or the generated schema drifts from the runtime.

Tailwind 4 is CSS-first — no `tailwind.config.js`. The entry is `@import "tailwindcss"` in `src/styles/global.css`, pulled in by `src/layouts/Layout.astro`.

**Nocturne's 0.70x density makes every Tailwind spacing step 2.8px, not 4px** — `--spacing` is set in the `@theme` block, so `gap-3` is 8.4px, `p-6` is 16.8px, and so on down the scale. This is the trap when porting a design: a value the canvas states in pixels must be written in pixels (`gap-[12px]`), because the numbered utility that looks like it matches is 30% short. Nothing errors; the layout is just quietly tighter than the artboard everywhere at once.

`wrangler.jsonc` currently has no `nodejs_compat` flag. Add it if Better Auth needs it — don't add it pre-emptively.

## Traps — verified against shipped packages, not docs

These are the mistakes most likely to be made from memory or from stale tutorials. Each was confirmed by reading the published package.

**Cloudflare's Astro framework guide is out of date.** It still documents the pre-Astro-6 shape. Prefer Astro's own adapter docs, and prefer the package's behaviour over both.

- **Bindings are imported, not on `locals`.** Astro 6 removed the `runtime` locals. Use `import { env } from 'cloudflare:workers'` — *not* `Astro.locals.runtime.env`. Also `Astro.request.cf`, the global `caches`, and `Astro.locals.cfContext`. `env` is module-scope, so bindings need not be threaded through the request.
- **No `_worker.js` build output.** The entrypoint is `@astrojs/cloudflare/entrypoints/server`, resolved automatically. Never hand-write `main` to `dist/_worker.js/*`.
- **`.assetsignore` is adapter-managed** (along with `_headers` and `_redirects`). Writing one by hand is a pre-v6 workaround.
- **D1 has no interactive transactions.** Drizzle's `db.transaction()` exists and type-checks on D1 but emits raw `begin`/`commit` that the binding ignores. **Use `db.batch()`.** Treat `db.transaction()` as unavailable — this fails silently, not loudly.
- **Better Auth adapters moved into separate packages** in 1.7.x: `@better-auth/drizzle-adapter`. Corrected 2026-09-12 against the shipped 1.7.4: `better-auth/adapters/drizzle` still exists and still works — it is now a one-line re-export of the scoped package, which `better-auth` itself depends on. We import the scoped package directly because that is where the code actually lives, but code using the old path is not broken.
- **Astro's Sessions API auto-wires to a `SESSION` KV namespace**, which will quietly compete with Better Auth. Better Auth is the only source of truth for identity. Settled two ways: `session: false` in `astro.config.mjs` turns the Astro one off, and Better Auth's KV binding is named `AUTH_KV` so it could not collide even if something re-enabled it.
- **Static by default; opt into SSR per route.** `output` stays `"static"` and a page is server-rendered only if it exports `prerender = false` (the build flips to server mode as soon as one route does). Cloudflare's guide claims the adapter forces `output: 'server'` — it does not. **Forgetting `prerender = false` on an auth-gated or live page silently ships a build-time snapshot.**
- **`astro:assets` is wired to a binding we do not have.** The adapter's `imageService` defaults to `"cloudflare-binding"`, which routes every transform through Cloudflare Images and expects an `IMAGES` binding — `wrangler.jsonc` declares none, and `Env` has no such key. That is what the `Enabling image processing with Cloudflare Images…` line in every build is announcing. **It does not fail at build; it fails on the first image request in production**, because transforms happen per request. Until a binding exists, static images go in `public/` and are sized by hand. `imageService: 'compile'` is the alternative that needs no binding, at the cost of a slower build.
- **Astro 7:** Vite 8, stricter Rust compiler (unclosed tags are errors), Sätteri instead of remark/rehype, `compressHTML` defaults to `'jsx'`, and `src/fetch.ts` is reserved — no application code there.

### Better Auth on Workers — all verified against 1.7.4, not docs

Every one of these defaults is wrong *specifically* on Workers, and every one fails silently. They are configured in `src/lib/auth-options.ts`; the comments there say why. Re-check them on upgrade.

- **`nodejs_compat` is not needed.** Every `node:` import in the package is confined to `test-utils/` and the Node integration — nothing on our path. Still don't add it pre-emptively.
- **Better Auth cannot see Worker secrets.** Its env lookup reads `process.env`/Deno/Bun only, none of which exist here; Worker secrets arrive on the `env` binding. `secret` and `baseURL` are passed explicitly, or they are silently `undefined`.
- **Rate limiting would be off in production.** `rateLimit.enabled` defaults to `isProduction`, derived from `NODE_ENV` — unset on Workers. Set it explicitly.
- **`rateLimit.storage` defaults to `"secondary-storage"` whenever a secondary storage exists.** KV has no atomic increment, so limits silently undercount under concurrency. Ours is pinned to `"database"`, and the KV `increment` throws rather than approximating, so flipping it back cannot quietly weaken the limit.
- **Verification records default to KV-only when a secondary storage exists** — that includes magic-link tokens, which would then be non-reconstructible from D1 and hostage to KV's eventual consistency. `verification.storeInDatabase: true`.
- **`session.storeSessionInDatabase: true` is what makes KV a cache rather than a clock.** Re-confirmed on 1.7.4 by reading `findSession` and by deleting the KV key out from under a live session: it fell back to D1 and the session survived. **`preserveSessionInDatabase` must stay false** — it is part of the same condition and re-introduces the logout bug.
- **Type inference is load-bearing on how the options are typed.** Annotating them `: BetterAuthOptions` widens `user.additionalFields` away and `session.user.role` stops existing; the options object uses `satisfies` instead.
- **The Better Auth CLI cannot load `src/lib/auth.ts`** — it runs under Node, where `cloudflare:workers` does not resolve. `auth.config.ts` exists only to give the generator the schema-shaping options over a stub adapter. Its "Drizzle schema mismatch" and base-URL warnings are expected noise from that stub; the runtime adapter is silent, which is how you tell a real mismatch apart.

## Rules that shape the code

- **KISS and YAGNI govern scope.** Smallest thing that solves a problem the lab has today. Prefer a field over a table, one store over three.
- **Storage boundaries.** D1 is the system of record. R2 holds blobs only, always served *through* the Worker (never a bucket URL), including in-browser PDF preview with pinned `Content-Type`, `Content-Disposition: inline`, and a restrictive CSP. KV holds sessions only and is never authoritative — every value must be reconstructible from D1.
- **Invariants live in SQL,** because `batch()` needs its statements known up front. Guarded writes (`UPDATE ... WHERE status = ?`, `INSERT ... WHERE EXISTS (...)`) plus an assertion on the change count, not read-then-write.
- **Nothing runs on a schedule.** No Cron Triggers, no background jobs. Where automation is tempting, the answer is a query that gives an admin visibility.
- **Migrations:** `drizzle-kit` generates, `wrangler d1 migrations apply` applies — the only apply path, for every environment. Never `drizzle-kit push` against a deployed database.
- **Better Auth owns its own tables.** On upgrade, review the regenerated schema diff as a migration; never apply it blind.
- **Email is capped at 100/day** on Resend's free plan. Outcome notifications burst when a month's lineup is decided, so they go through the `notification` queue table at a measured pace — never `Promise.all` over the pool.

## Environment notes

- `.claude/settings.json` enables the official `cloudflare` plugin (Workers API, bindings, builds, observability MCP servers, plus Cloudflare skills). A `better-auth` MCP server and Better Auth skills are also available.
- Sending domain is `ilabccds.com`, DNS already on Cloudflare; mail goes out as `no-reply@ilabccds.com` and nobody reads replies.
