import { env } from 'cloudflare:workers';
import { FORMATS, LEVELS, type Format, type Level } from '../db/schema';

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
 * These go to the D1 binding directly rather than through Drizzle. Drizzle's
 * `db.batch()` only takes its own query builders — it reaches for a prepared
 * `stmt` that a raw `db.run(sql\`…\`)` never carries, and throws `Cannot read
 * properties of undefined (reading 'bind')` when handed one. The builders
 * cannot express `INSERT … SELECT … WHERE EXISTS`, which is the shape every
 * guard here needs, so the guarded writes use `env.DB` and reads stay on
 * Drizzle.
 */

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
	return env.DB.prepare(
		`insert into proposal_revision
			(id, proposal_id, revision, title, abstract, format, level, topics, links, bio)
		 select ?, ?,
			coalesce((select max(revision) from proposal_revision where proposal_id = ?), 0) + 1,
			?, ?, ?, ?, ?, ?, ?
		 where exists (select 1 from proposal where id = ? and speaker_id = ?)`,
	).bind(
		crypto.randomUUID(),
		proposalId,
		proposalId,
		c.title,
		c.abstract,
		c.format,
		c.level,
		JSON.stringify(c.topics),
		JSON.stringify(c.links),
		c.bio,
		proposalId,
		speakerId,
	);
}

/** D1 reports affected rows on `meta.changes`. */
function changed(result: D1Result): number {
	return result.meta.changes ?? 0;
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
		env.DB.prepare(
			`insert into proposal
				(id, cfp_id, speaker_id, title, abstract, format, level, topics, links, bio)
			 select ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
			 where exists (
				select 1 from cfp where id = ? and (closes_at is null or closes_at > ?)
			 )`,
		).bind(
			id,
			opts.cfpId,
			opts.speakerId,
			c.title,
			c.abstract,
			c.format,
			c.level,
			JSON.stringify(c.topics),
			JSON.stringify(c.links),
			c.bio,
			opts.cfpId,
			now,
		),
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
		env.DB.prepare(
			`update proposal set
				title = ?, abstract = ?, format = ?, level = ?,
				topics = ?, links = ?, bio = ?, updated_at = ?
			 where id = ? and speaker_id = ?`,
		).bind(
			c.title,
			c.abstract,
			c.format,
			c.level,
			JSON.stringify(c.topics),
			JSON.stringify(c.links),
			c.bio,
			Date.now(),
			opts.id,
			opts.speakerId,
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
	const now = Date.now();

	const result = await env.DB.prepare(
		`update proposal set
			status = 'submitted',
			submitted_at = coalesce(submitted_at, ?),
			updated_at = ?
		 where id = ? and speaker_id = ? and status = 'draft'
		   and exists (
				select 1 from cfp
				where cfp.id = proposal.cfp_id
				  and (cfp.closes_at is null or cfp.closes_at > ?)
		   )`,
	)
		.bind(now, now, opts.id, opts.speakerId, now)
		.run();

	if (changed(result) === 1) return { ok: true };

	// Only to word the message. The decision was already made above, in SQL —
	// this cannot change it, and a call closing between the two reads at worst
	// gives a right refusal a slightly wrong explanation.
	const open = await env.DB.prepare(
		`select exists (
			select 1 from cfp
			join proposal on proposal.cfp_id = cfp.id
			where proposal.id = ?
			  and (cfp.closes_at is null or cfp.closes_at > ?)
		 ) as open`,
	)
		.bind(opts.id, now)
		.first<{ open: number }>();

	return { ok: false, reason: open?.open ? 'not-draft' : 'closed' };
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
	const result = await env.DB.prepare(
		`update proposal set status = 'withdrawn', updated_at = ?
		 where id = ? and speaker_id = ? and status in ('submitted', 'accepted')`,
	)
		.bind(Date.now(), opts.id, opts.speakerId)
		.run();

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
	const result = await env.DB.prepare(
		`delete from proposal where id = ? and speaker_id = ? and status = 'draft'`,
	)
		.bind(opts.id, opts.speakerId)
		.run();

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
