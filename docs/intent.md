# ilab-cfs — Intent

A call-for-speakers platform for Innovation Lab @ NTU CCDS: TechTalks, DevHub workshops, and Catalyst senior sharing sessions.

Stack and scope are settled. This document records what the platform does and why it is shaped this way; it is the reference for implementation decisions, not a proposal.

## Principles

**KISS and YAGNI govern scope.** Build the smallest thing that solves a problem the lab has today. A table, a store, or a status value earns its place by being needed now — not by being easy to imagine needing. Adding it later is cheap; unused structure is not free.

## Purpose

Today, talks are solicited ad hoc through cold email, Telegram, and LinkedIn. Proposals end up scattered across personal accounts, there is no revision history, review happens in a group chat, and every outcome email is sent by hand.

This platform replaces that with one place where speakers pitch, organizers review, and outcomes are tracked and communicated.

## Users and roles

| Role | Who | Can |
| --- | --- | --- |
| Visitor | Anyone | Read the CFP page, see past and upcoming talks |
| Speaker | Anyone | Submit a proposal at any time, keep editing it, attach a deck whenever they like (required once confirmed), track status |
| Reviewer | Committee members appointed by an admin | Read the open pool and past talks, and comment |
| Admin | iLab Committee Top 4 | Create and close calls, invite reviewers, accept/reject proposals, schedule each month's talks, export |

## Core flows

1. **Register** — speakers create an account. Submission is not anonymous; there is no magic-link-only edit path to maintain.
2. **Submit** — speaker signs in, fills a proposal (title, abstract, format, level, topics, bio, links), optionally attaches a deck, saves as draft, and submits while the call is open. The abstract is required; the deck is optional at this stage.
3. **Edit** — proposals stay editable throughout, including after scheduling; the published schedule shows the current version. Edits are versioned so reviewers can see what changed.
4. **Review** — reviewers read the open pool, preview a deck in the browser where one was attached, and leave comments. Review is not blind: speaker identities are visible. A proposal is judged on its abstract, and a missing deck is not a mark against it.
5. **Decide** — admins mark accept or reject and trigger outcome notifications. Accepted proposals join a standing pool; they are not yet booked.
6. **Schedule** — admins create the month's event and assign talks from the pool to it. This is what the CFP feeds, and where a talk becomes real.
7. **Collect slides** — confirmation is the point at which a deck stops being optional, and it is due one week before the event. That date is a target an admin chases by hand, not a rule the system enforces: nothing is pulled or blocked when it passes.
8. **Publish** — scheduled talks appear on a public schedule and archive hosted by this platform. It replaces the lab site's manually updated events page rather than sitting beside it.

## Out of scope

Attendee registration and ticketing, payments, venue and AV logistics, live streaming or recording hosting, and a general-purpose CMS.

## Stack

Astro on Cloudflare Workers, with D1, R2, and KV, Drizzle for data access, Better Auth for authentication, and Resend for mail.

### Astro on Workers

**Astro 7** with **`@astrojs/cloudflare` 14.x** — verified 2026-09-05 against `astro@7.3.1` and `@astrojs/cloudflare@14.3.0`, which peer-requires `astro@^7.2.0` and `wrangler@^4.125.0`.

> **Beware stale guides.** Cloudflare's Astro framework guide still documents the pre-v6 shape (`main: ./dist/_worker.js/index.js`, a hand-written `public/.assetsignore`, `Astro.locals.runtime.env`). None of that is current — all three were verified against the shipped adapter code rather than documentation. Prefer Astro's own adapter docs, and prefer the package's behaviour over both.

- **Bindings are imported, not read off `locals`.** Astro 6 removed the `runtime` locals; the adapter now throws with explicit migration messages:
  - `Astro.locals.runtime.env` → `import { env } from 'cloudflare:workers'`
  - `Astro.locals.runtime.cf` → `Astro.request.cf`
  - `Astro.locals.runtime.caches` → the global `caches`
  - `Astro.locals.runtime.ctx` → `Astro.locals.cfContext`

  This matters beyond syntax: `env` is a module-scope import rather than a per-request value, so D1/R2/KV access no longer has to be threaded down from the request object.
- **No `_worker.js` output.** The server entrypoint is the adapter's own `@astrojs/cloudflare/entrypoints/server`, resolved automatically. Never hand-write `main` to a `dist/_worker.js/*` path — that build layout no longer exists.
- **`.assetsignore` is the adapter's job.** It manages `.assetsignore`, `_headers`, and `_redirects` itself; creating one by hand is a pre-v6 workaround.
- **Workers Static Assets, not Pages.** Cloudflare's guidance is that new projects use Workers, with Pages in maintenance.
- **Render mode is static by default** — verified at scaffold time, and the opposite of what Cloudflare's guide claims. `output` stays `"static"`; a route is server-rendered only when it declares `export const prerender = false`, and the build flips to server mode as soon as one route does. The CFP landing page and code of conduct need nothing. The schedule, the archive, and everything behind auth must declare `prerender = false` — **a page that forgets it ships as a build-time snapshot**, which on an authenticated or live page is a correctness bug rather than a performance one.
- **Astro 7 changes worth knowing when scaffolding:** Vite 8, a stricter Rust compiler (unclosed tags are errors; invalid HTML is no longer auto-corrected), Sätteri replacing remark/rehype for Markdown, `compressHTML` defaulting to `'jsx'`, and `src/fetch.ts` as a reserved filename — application code must not live there.
- **Let wrangler generate the initial config** (`wrangler setup`, or `wrangler deploy --x-autoconfig`) rather than hand-writing it; it detects Astro and writes the current shape.

### Storage split

The three stores are not interchangeable; the boundary matters more than any of them individually.

- **D1** — the system of record: users, accounts, sessions, calls, events, proposals and their revisions, reviews, attachment metadata, notifications, and the audit log. Anything we would be unwilling to lose or need to query relationally.
- **R2** — user-uploaded blobs only: proposal decks (PDF) and profile pictures. D1 holds the metadata row (key, size, content type, uploader); R2 holds the bytes. Uploads are served through the Worker, never by exposing bucket URLs, so access control stays in one place — including the in-browser preview, which streams through the Worker with an enforced `Content-Type` rather than redirecting to R2.
- **KV** — session storage, which is what the Astro adapter and Better Auth already want it for. Nothing else goes in until something is measurably slow. **Nothing in KV is authoritative:** every value must be reconstructible from D1, because KV is eventually consistent and a stale read must never change a decision.

### Data access — Drizzle over D1

Drizzle ORM (`drizzle-orm@0.45.2`, `drizzle-kit@0.31.10`) over D1, via Drizzle's first-party `drizzle-orm/d1` driver. Application tables and Better Auth's generated tables share one schema and one migration stream.

**D1 has no interactive transactions.** It runs in auto-commit; the only atomic primitive is `batch()`, which rolls back the whole sequence if any statement fails. Drizzle's `db.transaction()` exists and type-checks on D1 but emits raw `begin`/`commit` that the binding API does not honour — **use `db.batch()` and treat `db.transaction()` as unavailable.**

An atomic write must therefore be a list of statements known up front, which puts invariants in SQL rather than in read-then-write application logic:

- **Submission window** — `INSERT INTO proposal ... SELECT ... WHERE EXISTS (SELECT 1 FROM cfp WHERE id = ? AND (closes_at IS NULL OR closes_at > ?))`, so a submission racing a closing deadline loses deterministically. Continuous calls satisfy the condition for free, which is why it costs nothing to apply the same statement to both.
- **One decision per proposal** — `UPDATE proposal SET status = ? WHERE id = ? AND status = 'submitted'`, asserting on the change count, so two admins deciding at once cannot overwrite each other's outcome. Editing needs no such guard: it is unconditional for the owner.
- **Proposal + revision + audit_log** — one `batch()`, so a partial failure cannot leave a revision with no audit trail.
- **Decision + notification** — the status change and the queued `notification` row go in one `batch()`, so a speaker is never marked rejected with no notification pending, nor mailed about a decision that did not commit.

**Migrations.** `drizzle-kit` generates the SQL, `wrangler` applies it. Point wrangler's `migrations_dir` at Drizzle's output so `wrangler d1 migrations apply` is the only apply path for local, preview, and production. No `drizzle-kit push` against a deployed database.

**Schema ownership.** Better Auth's CLI generates its own tables; ours are hand-written. On a Better Auth upgrade, the regenerated diff is reviewed as a migration, never applied blind.

**Encoding.** D1 is SQLite — no native boolean or timestamp types, limited `ALTER TABLE`. Match Better Auth's generated conventions rather than picking our own.

### Auth

Better Auth, backed by D1.

- Better Auth owns its own tables (user, session, account, verification) and its own cookie-based sessions. This is **separate from Astro's Sessions API**, which the Cloudflare adapter auto-wires to a `SESSION` KV namespace. The two must not both be sources of truth for identity: Better Auth is the auth system, and Astro sessions, if used at all, hold incidental UI state.
- Roles (`speaker` / `reviewer` / `admin`) live in D1 and are enforced in middleware, not per-page, so a new protected route is covered by default.
- **Sign-in** is by email magic link or OAuth (Google, GitHub, LinkedIn) rather than passwords. A call for speakers has to be frictionless for people outside the lab.

**If sessions are cached in KV, set `session.storeSessionInDatabase: true`.** Better Auth issue [#4203](https://github.com/better-auth/better-auth/issues/4203) ("`secondaryStorage` ttl forces re-login on users") reported that `secondaryStorage` silently logs users out once its TTL elapses. The maintainer's workaround is that flag; the reporter confirmed it on 1.6.7 and the issue is closed.

**Re-confirmed on 1.7.4 (2026-09-12), and it is still a condition rather than a fix.** `findSession` returns null on a secondary-storage miss unless `storeSessionInDatabase` is set, and only then reads the database. Verified end to end by deleting the KV entry under a live session: the session survived and was served from D1. One addition the issue does not mention — **`preserveSessionInDatabase` must stay false.** It sits in the same condition, so enabling it puts the logout back, by design: rows kept after revocation would otherwise let a KV miss resurrect a revoked session.

It is the right shape regardless: it makes D1 authoritative for sessions and KV merely a cache — exactly what the [storage split](#storage-split) demands of KV.

### Email

**Resend**, for both transactional auth mail (Better Auth verification and magic links) and outcome notifications. Cloudflare Email Sending is not available on the free plan, which rules it out.

Called over HTTPS from the Worker with the API key held as a Worker secret, driven by the `notification` queue in D1. Better Auth needs no provider-specific integration: it calls a send function we supply, so the provider is one function to swap if Resend stops fitting.

Mail is sent from **`no-reply@ilabccds.com`**. That domain's DNS is already on Cloudflare, so Resend's verification records are self-serve — complete them before either flow can be tested end to end.

Nobody reads replies to that address, so **every message must be self-contained and end at a link back to the platform.** A speaker with a question needs somewhere to click; a reply into the void is the failure mode of a no-reply sender.

**Free plan: 3,000 emails per month, 100 per day, 3 domains, 30-day log retention.** The daily cap is the one that bites: outcome notifications go out in a burst when a month's lineup is decided. Send them through the queue at a measured pace rather than a `Promise.all` over the whole pool, and treat a failed send as retryable rather than lost.

## Data model

The entities and the relationships that constrain the design, not a schema.

- `cfp` — a call for speakers: a name, a track label (TechTalks / DevHub workshop / Catalyst), and a nullable `closes_at`. **`closes_at IS NULL` is a continuously running call; a date makes it an event-specific call that stops taking submissions at that moment.** Track is a field here, not a table, until a track needs data of its own.
- `event` — a scheduled session: a name, `starts_at` and `ends_at`, a venue with its map link, a registration link, and an optional description. Several talks belong to one event. There is no separate date column — the date is the date part of `starts_at`, so the deck deadline (one week before) and the public listing both derive from one value that cannot drift.
- `proposal` — belongs to a speaker and to the call it was submitted to. Carries a status (`draft`, `submitted`, `accepted`, `rejected`, `withdrawn`) and a nullable `event_id`. An accepted proposal with no event is waiting to be booked.
- `proposal_revision` — append-only snapshots, so review comments can be read against the version they were written about.
- `review` — a comment by a reviewer on a proposal. Reviewers may leave several on the same proposal.
- `attachment` — R2 metadata owned by a proposal. PDF only, 25 MB maximum, which streams through the Worker comfortably against the free-plan request body limit of 100 MB. Optional at submission and required once a speaker is confirmed, so the requirement is a check at confirmation time rather than a column on the row. No malware scanning.
- `audit_log` — who changed what status, and when.
- `notification` — one row per outbound message we originate: recipient, related proposal, kind (outcome, scheduled), state (`queued` / `sent` / `failed`), attempt count, last error, and Resend's message id once accepted. **It stores no message body** — recording a magic link or a rendered email is a liability, and the row only needs to answer whether the message was sent.

A month's lineup is the set of proposals pointing at that month's event. Keep `event` minimal — add a field when an event actually needs one, not in anticipation.

Store `starts_at` / `ends_at` as UTC instants and render them in Singapore time. Talks are local, so a wall-clock string is tempting, but it makes "one week before" arithmetic and any future calendar export needlessly fragile.

**The `notification` table is a send queue, not merely a log.** That is what earns it a place: it makes paced delivery possible under Resend's daily cap, makes a failed send retryable instead of lost, and outlives Resend's own 30-day log retention. Auth mail does not go through it — Better Auth owns that flow, it is user-triggered rather than bursty, and queueing it would only put sensitive links in our database.

**Nothing runs on a schedule.** No Cron Triggers, no background jobs, no deck-reminder mail; chasing is manual. What the platform owes an admin instead is visibility: a list of upcoming talks still missing a deck, and a list of undecided proposals left behind in closed calls. Both are queries, not schedulers, and both turn chasing into a glance rather than a spreadsheet.

**Nobody outside the committee is notified when a confirmed speaker edits or withdraws.** The schedule page simply reflects it. That keeps notifications to two kinds and avoids an audience-subscription model nobody asked for.

**Reviewers are admin-invited, but that needs no invitation table.** An admin sets the reviewer role on a registered user.

**Nothing stops a reviewer commenting on their own proposal.** Committee members pitch workshops as well as review them, so the roles overlap by design, and a self-deprecating comment on your own submission is part of the fun. This is a deliberate absence, not a gap to be closed later.

## Constraints

- A proposal stays editable for its whole life, and a scheduled speaker may still edit or withdraw. The public schedule is therefore always derived, never a snapshot — a withdrawal removes the talk from it.
- **Both kinds of call exist at the same time.** Continuous calls run indefinitely; event-specific calls close. Nothing may assume a single current call, and nothing may assume calls never close — every submission path checks the call it is writing to.
- **Closing a call stops new submissions and nothing else.** Proposals already in a closed call are still reviewed, decided, scheduled, and edited by their authors. A closed call is not an archive.
- **Undecided proposals stay in the call they were pitched to.** Nothing is reassigned when a call closes, so the record of what was submitted to an event stays true, and a speaker who offered a talk for a specific event never finds it slotted into an unrelated month. If a proposal deserves a second life, the speaker resubmits it to their track's continuous call — the person who owns the talk decides it should stay alive, which keeps the consent question from arising at all.
- Decks render in the browser for reviewers and admins. A PDF is active content, so it is served from the Worker with a pinned `Content-Type`, `Content-Disposition: inline`, and a restrictive CSP — never by handing out an R2 URL.

## Open questions

None outstanding. New ones are recorded here as they surface.
