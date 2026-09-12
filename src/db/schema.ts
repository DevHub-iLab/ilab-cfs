/**
 * The one schema, feeding the one migration stream.
 *
 * Better Auth owns `auth-schema.ts` and regenerates it wholesale — never hand
 * edit that file. Application tables (cfp, event, proposal, …) are added here
 * as they are built.
 */
import { sql } from 'drizzle-orm';
import { sqliteTable, text, integer, index } from 'drizzle-orm/sqlite-core';

export * from './auth-schema';

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
