import { env } from 'cloudflare:workers';
import { and, eq, exists, gt, inArray, is, isNull, or, sql, SQL } from 'drizzle-orm';
import { SQLiteAsyncDialect } from 'drizzle-orm/sqlite-core';
import { db } from '../db';
import {
	cfp,
	proposal,
	proposalRevision,
	FORMATS,
	LEVELS,
	type Format,
	type Level,
} from '../db/schema';

/**
 * Writing a proposal.
 *
 * Every write here is one guarded statement plus an assertion on how many rows
 * it changed — never a read, a decision in JavaScript, and then a write. D1
 * runs in auto-commit and has no interactive transactions, so a read-then-write
 * has nothing holding the world still between the two halves; the guard has to
 * travel with the statement.
 *
 * Where two statements must land together they go through `batch()`, which
 * rolls back the whole sequence if any statement fails. Note what that does
 * *not* cover: a guarded statement matching zero rows is a successful statement,
 * not a failed one, so a batch cannot express "submit, but only if the call is
 * open". That is why submitting is two steps rather than one — see `submit()`.
 *
 * **Why two kinds of statement live here.** Anything Drizzle can build, Drizzle
 * builds: the column names are then checked against the schema and the values
 * are named rather than counted, and a JSON column serialises itself.
 *
 * The two guarded inserts are the exception, and only for a specific reason.
 * `db.insert(t).select(…)` does exist, but it emits the table's *entire* column
 * list, so the select has to supply every column — including the ones with SQL
 * defaults — and adding a column later breaks it. These inserts deliberately
 * name a subset and let `status`, `created_at` and `updated_at` default, so they
 * are written as `sql` templates instead.
 *
 * Those templates go to the binding rather than `db.batch()`, which takes only
 * Drizzle's own builders: a raw `db.run(sql\`…\`)` executes immediately and
 * returns a promise, not something batchable. `statement()` below lowers either
 * kind to a D1 statement so a typed builder and a raw guard can share one batch.
 */

const dialect = new SQLiteAsyncDialect();

/**
 * Lower a Drizzle query — a builder or a `sql` template — to a D1 statement.
 *
 * This is what lets the batched pairs mix the two: `env.DB.batch()` wants D1
 * statements, and both kinds can be rendered to the same `{ sql, params }`.
 * Values stay attached to the place they are used in either form, so there is
 * no hand-ordered bind list to get wrong.
 */
function statement(query: SQL | { toSQL(): { sql: string; params: unknown[] } }) {
	const { sql: text, params } = is(query, SQL) ? dialect.sqlToQuery(query) : query.toSQL();
	return env.DB.prepare(text).bind(...params);
}

export interface ProposalContent {
	title: string;
	abstract: string;
	format: Format;
	level: Level;
	topics: string[];
	links: string[];
	bio: string;
}

/** Narrow an untrusted string to a union member, falling back to the default. */
function oneOf<T extends string>(values: readonly T[], raw: unknown, fallback: T): T {
	return typeof raw === 'string' && (values as readonly string[]).includes(raw)
		? (raw as T)
		: fallback;
}

/**
 * Read a submitted form into content.
 *
 * Nothing here rejects: a draft is allowed to be half-written, so every field
 * has a resting value and an unrecognised `format` becomes the default rather
 * than an error. What must be true to *submit* is checked in `submit()`, which
 * is the only place it matters.
 */
export function readContent(form: FormData): ProposalContent {
	const text = (name: string) => String(form.get(name) ?? '').trim();
	const list = (name: string) =>
		form.getAll(name).map((v) => String(v).trim()).filter(Boolean);

	/*
	  Topics arrive from three places at once, which is what lets the chip
	  editor work with no scripting: each chip carries a hidden `topics` input,
	  the "add topic" box may hold several separated by commas, and a chip's ✕
	  is a submit button naming the topic it removes. Order is preserved and
	  duplicates collapse, so adding one that is already there is a no-op rather
	  than a second identical chip.
	*/
	const removed = new Set(form.getAll('remove-topic').map((v) => String(v).trim()));
	const added = text('add-topic')
		.split(',')
		.map((t) => t.trim())
		.filter(Boolean);

	const topics = [...new Set([...list('topics'), ...added])].filter((t) => !removed.has(t));

	return {
		title: text('title'),
		abstract: text('abstract'),
		format: oneOf(FORMATS, form.get('format'), 'talk'),
		level: oneOf(LEVELS, form.get('level'), 'intermediate'),
		topics,
		// One input per link, including a blank one the speaker can type into
		// without scripting. Empty rows drop out here rather than being stored.
		links: list('links'),
		bio: text('bio'),
	};
}

/** A proposal may be submitted once it says what the talk is. */
export function missingForSubmission(content: ProposalContent): string | null {
	if (!content.title) return 'Give the talk a title before submitting it.';
	if (!content.abstract) return 'The abstract is what reviewers read. It cannot be empty.';
	return null;
}

/**
 * The revision snapshot, numbered in SQL.
 *
 * The number comes from a scalar subquery rather than a `max()` over the outer
 * select on purpose: an aggregate with no GROUP BY returns a row even when its
 * WHERE matches nothing, so an ownership guard in that WHERE would be filtered
 * away rather than enforced, and the insert would proceed for anyone. Here the
 * guard sits in a plain `WHERE EXISTS` over a non-aggregate select, where it
 * does what it reads like.
 */
function insertRevision(proposalId: string, speakerId: string, c: ProposalContent) {
	return statement(sql`
		insert into ${proposalRevision}
			(id, proposal_id, revision, title, abstract, format, level, topics, links, bio)
		select
			${crypto.randomUUID()},
			${proposalId},
			coalesce((select max(revision) from ${proposalRevision}
			          where ${proposalRevision.proposalId} = ${proposalId}), 0) + 1,
			${c.title}, ${c.abstract}, ${c.format}, ${c.level},
			${JSON.stringify(c.topics)}, ${JSON.stringify(c.links)}, ${c.bio}
		where exists (
			select 1 from ${proposal}
			where ${proposal.id} = ${proposalId} and ${proposal.speakerId} = ${speakerId}
		)
	`);
}

/**
 * D1 reports affected rows on `meta.changes`, and Drizzle passes its result
 * through untouched, so one reader serves both kinds of statement.
 */
function changed(result: { meta?: { changes?: number } }): number {
	return result?.meta?.changes ?? 0;
}

/**
 * Start a proposal against a call that is still open.
 *
 * The window is checked inside the insert, so a draft started against a call
 * that closed a millisecond ago loses deterministically instead of racing.
 */
export async function create(opts: {
	speakerId: string;
	cfpId: string;
	content: ProposalContent;
}): Promise<{ id: string } | { error: 'closed' }> {
	const id = crypto.randomUUID();
	const now = Date.now();
	const c = opts.content;

	const [inserted] = await env.DB.batch([
		statement(sql`
			insert into ${proposal}
				(id, cfp_id, speaker_id, title, abstract, format, level, topics, links, bio)
			select
				${id}, ${opts.cfpId}, ${opts.speakerId},
				${c.title}, ${c.abstract}, ${c.format}, ${c.level},
				${JSON.stringify(c.topics)}, ${JSON.stringify(c.links)}, ${c.bio}
			where exists (
				select 1 from ${cfp}
				where ${cfp.id} = ${opts.cfpId}
				  and (${cfp.closesAt} is null or ${cfp.closesAt} > ${now})
			)
		`),
		insertRevision(id, opts.speakerId, c),
	]);

	return changed(inserted) === 1 ? { id } : { error: 'closed' };
}

/**
 * Save content the speaker owns.
 *
 * Unguarded by the submission window, deliberately: closing a call stops new
 * submissions and nothing else, so an author keeps editing a proposal that is
 * already in a closed call — and a scheduled speaker keeps editing too. The
 * only guard is ownership, and it travels in the WHERE clause.
 */
export async function save(opts: {
	id: string;
	speakerId: string;
	content: ProposalContent;
}): Promise<boolean> {
	const c = opts.content;

	const [updated] = await env.DB.batch([
		// Built by Drizzle and lowered, so the column names are checked, the
		// values are named, and `topics`/`links` serialise themselves.
		// `updated_at` is set by the schema's `$onUpdate`.
		statement(
			db
				.update(proposal)
				.set({
					title: c.title,
					abstract: c.abstract,
					format: c.format,
					level: c.level,
					topics: c.topics,
					links: c.links,
					bio: c.bio,
				})
				.where(and(eq(proposal.id, opts.id), eq(proposal.speakerId, opts.speakerId))),
		),
		insertRevision(opts.id, opts.speakerId, c),
	]);

	return changed(updated) === 1;
}

/**
 * Move a draft to submitted, if its call is still open.
 *
 * Separate from `save()` rather than batched with it, because the two have
 * different answers when the call has closed: the edit is still the author's to
 * make and is kept, while the submission is refused. Batching them would either
 * discard an edit the speaker is entitled to or record a submission that did
 * not happen.
 *
 * `status = 'draft'` in the guard is what makes this idempotent — a double
 * submit changes nothing the second time rather than moving an accepted
 * proposal backwards.
 */
export async function submit(opts: {
	id: string;
	speakerId: string;
}): Promise<{ ok: true } | { ok: false; reason: 'closed' | 'not-draft' }> {
	const now = new Date();

	const result = await db
		.update(proposal)
		.set({
			status: 'submitted',
			// First crossing only: a resubmission never moves the original date.
			submittedAt: sql`coalesce(${proposal.submittedAt}, ${now.getTime()})`,
		})
		.where(
			and(
				eq(proposal.id, opts.id),
				eq(proposal.speakerId, opts.speakerId),
				eq(proposal.status, 'draft'),
				exists(
					db
						.select({ open: sql`1` })
						.from(cfp)
						.where(
							and(
								eq(cfp.id, proposal.cfpId),
								or(isNull(cfp.closesAt), gt(cfp.closesAt, now)),
							),
						),
				),
			),
		);

	if (changed(result) === 1) return { ok: true };

	// Only to word the message. The decision was already made above, in SQL —
	// this cannot change it, and a call closing between the two reads at worst
	// gives a right refusal a slightly wrong explanation.
	const [stillOpen] = await db
		.select({ id: cfp.id })
		.from(cfp)
		.innerJoin(proposal, eq(proposal.cfpId, cfp.id))
		.where(
			and(eq(proposal.id, opts.id), or(isNull(cfp.closesAt), gt(cfp.closesAt, now))),
		)
		.limit(1);

	return { ok: false, reason: stillOpen ? 'not-draft' : 'closed' };
}

/**
 * Take a pitch back.
 *
 * Allowed from `submitted` and `accepted` — including after a talk has been
 * scheduled, which is deliberate: the public schedule is derived from the
 * proposals behind it rather than snapshotted, so a withdrawal simply removes
 * the talk from it. A draft is not withdrawn, it is deleted; there is nothing
 * to take back.
 */
export async function withdraw(opts: { id: string; speakerId: string }): Promise<boolean> {
	const result = await db
		.update(proposal)
		.set({ status: 'withdrawn' })
		.where(
			and(
				eq(proposal.id, opts.id),
				eq(proposal.speakerId, opts.speakerId),
				inArray(proposal.status, ['submitted', 'accepted']),
			),
		);

	return changed(result) === 1;
}

/**
 * Delete a draft.
 *
 * Drafts only, because nothing else here is the speaker's alone to erase: once
 * a proposal has been submitted the committee has read it, and the honest exit
 * is `withdraw()`, which leaves the record standing. The revisions go with it
 * on the foreign key's cascade — D1 enforces those, so no second statement is
 * needed and none can be missed.
 */
export async function remove(opts: { id: string; speakerId: string }): Promise<boolean> {
	const result = await db
		.delete(proposal)
		.where(
			and(
				eq(proposal.id, opts.id),
				eq(proposal.speakerId, opts.speakerId),
				eq(proposal.status, 'draft'),
			),
		);

	/*
	  `> 0`, not `=== 1`, and only here.

	  D1 counts rows removed by a foreign key's cascade in `meta.changes`, so
	  deleting a draft reports 1 plus one per revision — measured: 1 with no
	  revisions, 2 with one, 4 with three. Asserting on exactly one row therefore
	  called every real delete a failure while the delete itself went through,
	  which is the worst shape a bug can take: the work happens and the answer
	  says it did not.

	  The guard is still exact. `id` is a primary key, so at most one proposal can
	  match and anything above one is its own history following it out.
	*/
	return changed(result) > 0;
}
