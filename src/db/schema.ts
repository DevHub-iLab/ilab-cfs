/**
 * The one schema, feeding the one migration stream.
 *
 * Better Auth owns `auth-schema.ts` and regenerates it wholesale — never hand
 * edit that file. Application tables (cfp, event, proposal, …) are added here
 * as they are built.
 */
import { sql } from 'drizzle-orm';
import { sqliteTable, text, integer, index, uniqueIndex } from 'drizzle-orm/sqlite-core';

export * from './auth-schema';
import { user } from './auth-schema';

/** The three things the lab runs. A field, not a table, until a track needs data of its own. */
export const TRACKS = ['techtalks', 'devhub', 'catalyst'] as const;
export type Track = (typeof TRACKS)[number];

/**
 * A call for speakers.
 *
 * `closes_at IS NULL` is a continuously running call; a date makes it an
 * event-specific call that stops taking submissions at that moment. Both kinds
 * are live at the same time, so nothing may assume a single current call.
 *
 * There is no `status` column: closing a call *is* setting `closes_at`, and
 * "open" is `closes_at IS NULL OR closes_at > now` — the same predicate the
 * submission guard already has to run in SQL. A second source of truth for
 * open-ness could only disagree with it.
 *
 * Timestamp and id conventions follow Better Auth's generated tables rather
 * than picking our own, so one migration stream stays internally consistent.
 */
export const cfp = sqliteTable(
	'cfp',
	{
		id: text('id')
			.primaryKey()
			.$defaultFn(() => crypto.randomUUID()),
		name: text('name').notNull(),
		track: text('track', { enum: TRACKS }).notNull(),
		/** The blurb under the name on the landing page. */
		description: text('description'),
		closesAt: integer('closes_at', { mode: 'timestamp_ms' }),
		createdAt: integer('created_at', { mode: 'timestamp_ms' })
			.default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
			.notNull(),
		updatedAt: integer('updated_at', { mode: 'timestamp_ms' })
			.default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
			.$onUpdate(() => new Date())
			.notNull(),
	},
	// The landing page's only query — open calls, soonest deadline first —
	// reads this column on every request.
	(table) => [index('cfp_closesAt_idx').on(table.closesAt)],
);

export type Cfp = typeof cfp.$inferSelect;

/** What a speaker is offering to do in the room. */
export const FORMATS = ['talk', 'workshop', 'lightning'] as const;
export type Format = (typeof FORMATS)[number];

/** Who the talk is pitched at, not how hard it was to prepare. */
export const LEVELS = ['beginner', 'intermediate', 'advanced'] as const;
export type Level = (typeof LEVELS)[number];

/**
 * The five states a proposal can be in. `withdrawn` is the speaker's own exit
 * and `rejected` the committee's; there is deliberately no `waitlisted` —
 * an accepted proposal with no event *is* the waiting list.
 */
export const PROPOSAL_STATUSES = [
	'draft',
	'submitted',
	'accepted',
	'rejected',
	'withdrawn',
] as const;
export type ProposalStatus = (typeof PROPOSAL_STATUSES)[number];

/**
 * A pitch, belonging to a speaker and to the call it was pitched to.
 *
 * The content columns are `notNull` with empty defaults rather than nullable:
 * a draft is allowed to be half-written — the design's own example is
 * "Untitled — something about WebGPU" — so emptiness is a normal state, not a
 * missing value. Completeness is asserted when the status becomes `submitted`,
 * which is the moment it starts to matter.
 *
 * `topics` and `links` are JSON arrays rather than two more tables. Nothing
 * queries across them yet — no screen filters by topic — and a field beats a
 * table until something needs the join.
 *
 * No `event_id` column yet: `event` does not exist, and a nullable column is
 * a cheap `ALTER TABLE` once it does.
 */
export const proposal = sqliteTable(
	'proposal',
	{
		id: text('id')
			.primaryKey()
			.$defaultFn(() => crypto.randomUUID()),

		cfpId: text('cfp_id')
			.notNull()
			.references(() => cfp.id),

		// A speaker's proposals go with them: nothing here outlives the account
		// that owns it, and the lab has no claim on a withdrawn pitch.
		speakerId: text('speaker_id')
			.notNull()
			.references(() => user.id, { onDelete: 'cascade' }),

		status: text('status', { enum: PROPOSAL_STATUSES }).notNull().default('draft'),

		title: text('title').notNull().default(''),
		abstract: text('abstract').notNull().default(''),
		format: text('format', { enum: FORMATS }).notNull().default('talk'),
		level: text('level', { enum: LEVELS }).notNull().default('intermediate'),
		topics: text('topics', { mode: 'json' }).$type<string[]>().notNull().default([]),
		links: text('links', { mode: 'json' }).$type<string[]>().notNull().default([]),
		bio: text('bio').notNull().default(''),

		/** First crossing into `submitted`. Null while it has never left draft. */
		submittedAt: integer('submitted_at', { mode: 'timestamp_ms' }),

		createdAt: integer('created_at', { mode: 'timestamp_ms' })
			.default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
			.notNull(),
		updatedAt: integer('updated_at', { mode: 'timestamp_ms' })
			.default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
			.$onUpdate(() => new Date())
			.notNull(),
	},
	(table) => [
		// "My proposals", and the reviewer's pool grouped by call.
		index('proposal_speakerId_idx').on(table.speakerId),
		index('proposal_cfpId_status_idx').on(table.cfpId, table.status),
	],
);

export type Proposal = typeof proposal.$inferSelect;

/**
 * An append-only snapshot of a proposal's content, written every time the
 * speaker saves.
 *
 * This exists so a reviewer's comment can be read against the wording it was
 * written about: proposals stay editable for life, so without it, tidying an
 * abstract would silently orphan the feedback on it. History cannot be
 * reconstructed after the fact, which is why it is here before the review
 * screens that consume it.
 *
 * Status is not snapshotted — it is not content, and a comment is never about
 * it.
 */
export const proposalRevision = sqliteTable(
	'proposal_revision',
	{
		id: text('id')
			.primaryKey()
			.$defaultFn(() => crypto.randomUUID()),

		proposalId: text('proposal_id')
			.notNull()
			.references(() => proposal.id, { onDelete: 'cascade' }),

		/** 1, 2, 3 … per proposal. Allocated in SQL, never read-then-written. */
		revision: integer('revision').notNull(),

		title: text('title').notNull(),
		abstract: text('abstract').notNull(),
		format: text('format', { enum: FORMATS }).notNull(),
		level: text('level', { enum: LEVELS }).notNull(),
		topics: text('topics', { mode: 'json' }).$type<string[]>().notNull(),
		links: text('links', { mode: 'json' }).$type<string[]>().notNull(),
		bio: text('bio').notNull(),

		createdAt: integer('created_at', { mode: 'timestamp_ms' })
			.default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
			.notNull(),
	},
	(table) => [
		// Both the guard against a duplicate revision number and the index the
		// history sidebar reads, newest first.
		uniqueIndex('proposal_revision_proposalId_revision_idx').on(
			table.proposalId,
			table.revision,
		),
	],
);

export type ProposalRevision = typeof proposalRevision.$inferSelect;
