# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

`ilab-cfs` — a call-for-speakers platform for Innovation Lab @ NTU CCDS (`DevHub-iLab/ilab-cfs`), covering TechTalks, DevHub workshops, and Catalyst sharing sessions.

**`docs/intent.md` is the source of truth for product and architecture decisions.** Read it before designing anything. It records not just what was decided but what was deliberately left out and why — several absences there (no `waitlisted` status, no cron, no conflict-of-interest check) are decisions, not gaps to close.

## Current state

Design is settled; **nothing is scaffolded yet**. No `package.json`, no `wrangler.jsonc`, no `astro.config.mjs`, no tests. Build/dev/test commands go in this file once the project is generated.

Scaffold with `wrangler setup` (or `wrangler deploy --x-autoconfig`) rather than hand-writing config — it detects Astro and writes the current shape.

## Stack

Astro 7 on Cloudflare Workers · D1 (Drizzle) · R2 · KV · Better Auth · Resend.

Verified 2026-09-05: `astro@7.3.1`, `@astrojs/cloudflare@14.3.0` (peer-requires `astro@^7.2.0`, `wrangler@^4.125.0`), `drizzle-orm@0.45.2`, `drizzle-kit@0.31.10`, `better-auth@1.7.2`.

## Traps — verified against shipped packages, not docs

These are the mistakes most likely to be made from memory or from stale tutorials. Each was confirmed by reading the published package.

**Cloudflare's Astro framework guide is out of date.** It still documents the pre-Astro-6 shape. Prefer Astro's own adapter docs, and prefer the package's behaviour over both.

- **Bindings are imported, not on `locals`.** Astro 6 removed the `runtime` locals. Use `import { env } from 'cloudflare:workers'` — *not* `Astro.locals.runtime.env`. Also `Astro.request.cf`, the global `caches`, and `Astro.locals.cfContext`. `env` is module-scope, so bindings need not be threaded through the request.
- **No `_worker.js` build output.** The entrypoint is `@astrojs/cloudflare/entrypoints/server`, resolved automatically. Never hand-write `main` to `dist/_worker.js/*`.
- **`.assetsignore` is adapter-managed** (along with `_headers` and `_redirects`). Writing one by hand is a pre-v6 workaround.
- **D1 has no interactive transactions.** Drizzle's `db.transaction()` exists and type-checks on D1 but emits raw `begin`/`commit` that the binding ignores. **Use `db.batch()`.** Treat `db.transaction()` as unavailable — this fails silently, not loudly.
- **Better Auth adapters are separate packages** since 1.7.x: `@better-auth/drizzle-adapter`, not `better-auth/adapters/drizzle`.
- **Astro's Sessions API auto-wires to a `SESSION` KV namespace**, which will quietly compete with Better Auth. Better Auth is the only source of truth for identity.
- **Astro 7:** Vite 8, stricter Rust compiler (unclosed tags are errors), Sätteri instead of remark/rehype, `compressHTML` defaults to `'jsx'`, and `src/fetch.ts` is reserved — no application code there.

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
