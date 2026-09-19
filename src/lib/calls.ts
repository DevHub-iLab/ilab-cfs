import { and, eq, gt, isNotNull, isNull, notExists, or, sql } from 'drizzle-orm';
import { changed, db } from '../db';
import { cfp, proposal, TRACKS, type Cfp, type Track } from '../db/schema';

/**
 * Opening and closing calls.
 *
 * Nothing here adds a status column, and that is the whole design. A call is
 * open while `closes_at IS NULL OR closes_at > now` — the predicate the
 * homepage filters on and the one the submission guard already runs inside its
 * insert. **Closing a call is therefore an UPDATE of that single column**, and
 * the two kinds of call differ only in whether it is set at all. A separate
 * `status` could only ever disagree with the deadline sitting beside it.
 *
 * Every write is one statement with an assertion on `meta.changes`, the same
 * shape as `proposals.ts` and for the same reason: D1 runs in auto-commit and
 * has no interactive transactions, so a guard has to travel with the statement
 * it guards rather than sitting in a read before it. None needs `batch()` —
 * there is no second row to keep in step, and there will not be one until
 * `audit_log` exists.
 *
 * Editing is unguarded beyond the row still being there and not deleted, for
 * the reason `save()` in `proposals.ts` gives: an edit has no window to lose
 * and no state to move through. Two admins editing at once is last write wins,
 * which is what a form is.
 *
 * **Deleting is soft, and is the only write here that hides a row.** Nothing
 * removes a `cfp`: `remove()` stamps `deleted_at` and `restore()` clears it,
 * so a mis-click costs a click. The cost is that every other query has to say
 * it wants live calls, which is what `takingSubmissions()` is for — one
 * predicate, used by the homepage, the submit page and the insert's own guard,
 * so a screen cannot forget half of it.
 */

/**
 * How the three tracks are written for people. The homepage reads this too, so
 * a track renamed here is renamed everywhere it is shown.
 */
export const TRACK_LABELS: Record<Track, string> = {
	techtalks: 'TechTalks',
	devhub: 'DevHub',
	catalyst: 'Catalyst',
};

/**
 * What a speaker may see and submit to.
 *
 * Two clauses, and every reader needs both: a call is live while it has not
 * been deleted, and open while it has no deadline or its deadline is still
 * ahead. They are here rather than written out per page because the second
 * one used to be the whole predicate — a page copied from before the first
 * clause existed would go on advertising deleted calls, and nothing would
 * error.
 *
 * It is a Drizzle condition, so it drops into a builder's `where` and
 * interpolates into a raw `sql` template alike — which is what lets the
 * guarded insert in `proposals.ts` run the same test the homepage filters on.
 */
export function takingSubmissions(now: Date) {
	return and(isNull(cfp.deletedAt), or(isNull(cfp.closesAt), gt(cfp.closesAt, now)));
}

/** What an admin filled in. `closesAt: null` is a call that never closes. */
export interface CallDraft {
	name: string;
	track: Track;
	description: string | null;
	closesAt: Date | null;
}

/** Why a submitted form was refused. */
export type CallProblem = 'name' | 'track' | 'closes' | 'past';

/** One wording per refusal, so both screens say the same thing. */
export const CALL_PROBLEMS: Record<CallProblem, string> = {
	name: 'Give the call a name. It is what a speaker picks between, so make it say which month or which kind of session it is.',
	track: 'Pick a track.',
	closes: 'Pick a date and time for the deadline — or set the call to never close, if that is what it is.',
	past: 'That deadline has already passed, so the call would be shut the moment it opened.',
};

/**
 * The form's own shape — what the fields hold, rather than what gets written.
 *
 * It differs from `CallDraft` in the two places a form differs from a row:
 * the deadline is the wall clock the input speaks rather than an instant, and
 * `kind` is a question the row answers with a null.
 */
export interface CallFormValues {
	name: string;
	track: Track;
	description: string;
	kind: 'deadline' | 'continuous';
	closesAt: string;
}

/**
 * A blank form.
 *
 * `deadline` rather than `continuous` is the default on purpose: a call that
 * runs forever should be something an admin says, not something they get by
 * leaving a field alone — and a deadline is the common case anyway.
 */
export const BLANK_CALL: CallFormValues = {
	name: '',
	track: TRACKS[0],
	description: '',
	kind: 'deadline',
	closesAt: '',
};

/** An existing call, as the form holds it. */
export function callValues(call: Cfp): CallFormValues {
	return {
		name: call.name,
		track: call.track,
		description: call.description ?? '',
		kind: call.closesAt ? 'deadline' : 'continuous',
		closesAt: call.closesAt ? sgtWallClock(call.closesAt) : '',
	};
}

/**
 * What was typed, over what was there.
 *
 * A refused form comes back through the query string, so a missed deadline
 * field does not cost an admin the name and the blurb they wrote above it.
 * Nothing in it is sensitive — it is what they were about to publish on the
 * homepage. With no fields echoed, which is every other way of arriving, this
 * is the base untouched.
 */
export function echoed(params: URLSearchParams, base: CallFormValues): CallFormValues {
	const track = params.get('track');
	const kind = params.get('kind');

	return {
		name: params.get('name') ?? base.name,
		track: (TRACKS as readonly string[]).includes(track ?? '') ? (track as Track) : base.track,
		description: params.get('description') ?? base.description,
		kind: kind === 'continuous' || kind === 'deadline' ? kind : base.kind,
		closesAt: params.get('closes-at') ?? base.closesAt,
	};
}

const WALL_CLOCK = new Intl.DateTimeFormat('sv-SE', {
	dateStyle: 'short',
	timeStyle: 'short',
	timeZone: 'Asia/Singapore',
});

/**
 * An instant as the wall clock a `datetime-local` speaks — Singapore's.
 *
 * `sv-SE` is the shortcut: it formats as `2026-09-19 15:30`, which is the
 * input's own format bar the separator. The form's `min` is written with it
 * too, so what the picker offers and what the server accepts are the same
 * clock.
 */
export function sgtWallClock(at: Date): string {
	return WALL_CLOCK.format(at).replace(' ', 'T');
}

/**
 * Read a `datetime-local` value as Singapore time.
 *
 * The input posts a bare wall clock — `2026-10-30T23:59`, no zone — and a
 * `new Date()` over that reads it in *the runtime's* zone. On Workers that is
 * UTC, so a deadline typed as 11:59pm would be stored as 7:59am SGT and the
 * call would shut eight hours before the page said it would. Nothing would
 * error; the countdown would simply be wrong. Pinning the offset here is what
 * keeps the instant that is stored the one that was typed, and matches the
 * `Asia/Singapore` every screen renders in.
 *
 * `+08:00` rather than a zone name because Singapore has had no DST since 1935
 * and no offset change since 1982 — the one place a fixed offset is honest.
 */
function parseSgt(local: string): Date | null {
	const match = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})(:\d{2})?$/.exec(local.trim());
	if (!match) return null;

	const at = new Date(`${match[1]}T${match[2]}${match[3] ?? ':00'}+08:00`);
	if (Number.isNaN(at.getTime())) return null;

	/*
	  A day that does not exist is rolled over rather than refused — measured:
	  `2026-02-30T09:00+08:00` parses happily as 2 March. A date picker cannot
	  produce one, but a posted form can, and silently closing a call two days
	  after the date somebody typed is the kind of wrong that never gets
	  noticed. Read the instant back as a Singapore wall clock and insist it is
	  the one that was sent.
	*/
	return sgtWallClock(at) === `${match[1]}T${match[2]}` ? at : null;
}

/**
 * Read the new-call form.
 *
 * Unlike a proposal — which is allowed to be half-written, because a draft is a
 * normal state — a call is created complete or not at all: it is the thing
 * speakers pick between, and there is no draft of one. So this rejects rather
 * than falling back to defaults.
 *
 * A missing or unrecognised `kind` falls through to requiring a date, which
 * fails loudly. The other way round, an unreadable field would quietly mint a
 * call that never closes and that nobody asked for.
 *
 * `allowPast` is what separates the two screens. Creating a call already shut
 * is a typo — it would take no submissions and never reach the homepage. On an
 * existing call a past deadline is an ordinary answer: it is what every closed
 * call in the list has, so refusing it would mean a closed call's name could
 * never be corrected. Moving one forward, or switching to never closes, is
 * then how a call reopens — the deadline is the only thing that decides it, so
 * it needs no button of its own.
 */
export function readCallForm(
	form: FormData,
	{ allowPast = false }: { allowPast?: boolean } = {},
): { call: CallDraft } | { problem: CallProblem } {
	const name = String(form.get('name') ?? '').trim();
	if (!name || name.length > 120) return { problem: 'name' };

	const track = String(form.get('track') ?? '');
	if (!(TRACKS as readonly string[]).includes(track)) return { problem: 'track' };

	const description = String(form.get('description') ?? '').trim();

	const draft = {
		name,
		track: track as Track,
		description: description || null,
	};

	if (form.get('kind') === 'continuous') return { call: { ...draft, closesAt: null } };

	const closesAt = parseSgt(String(form.get('closes-at') ?? ''));
	if (!closesAt) return { problem: 'closes' };

	if (!allowPast && closesAt.getTime() <= Date.now()) return { problem: 'past' };

	return { call: { ...draft, closesAt } };
}

/** Open a call. Speakers can submit to it from the moment this returns. */
export async function create(draft: CallDraft): Promise<{ id: string }> {
	const id = crypto.randomUUID();

	const result = await db.insert(cfp).values({
		id,
		name: draft.name,
		track: draft.track,
		description: draft.description,
		closesAt: draft.closesAt,
	});

	// Unguarded, so anything but one row means the insert did not do what it
	// says. Throwing beats returning a success the caller would report.
	if (changed(result) !== 1) {
		throw new Error(`Creating a call changed ${changed(result)} rows, expected 1.`);
	}

	return { id };
}

/**
 * Change a call.
 *
 * Every field of it, the track included: a call created against the wrong one
 * is a typo an admin should be able to fix, and since a proposal reads its
 * track through the call it was pitched to, fixing it here fixes it for
 * everything already inside. What this cannot do is move a proposal between
 * calls — those stay where they were pitched, which is intent's rule and not
 * this screen's to break.
 *
 * The deadline is written exactly as given, past or future, so this is also
 * how a call is reopened or retroactively closed. Nothing else changes with
 * it: a closed call's proposals were never archived, so there is nothing to
 * bring back.
 */
export async function update(id: string, draft: CallDraft): Promise<boolean> {
	const result = await db
		.update(cfp)
		.set({
			name: draft.name,
			track: draft.track,
			description: draft.description,
			closesAt: draft.closesAt,
		})
		.where(and(eq(cfp.id, id), isNull(cfp.deletedAt)));

	// Zero rows means no such call, or one that has been deleted — an edit has
	// nothing else to fail on. Restoring is the way back to editing it.
	// `updated_at` is the schema's `$onUpdate`.
	return changed(result) === 1;
}

/**
 * Hide a call nobody has pitched to.
 *
 * Soft: the row stays and `deleted_at` is stamped, so `restore()` is the whole
 * undo and no `DELETE` is ever issued against `cfp`. What goes away is the
 * call's presence — the homepage, the submit page and the admin's own open and
 * closed lists all stop seeing it, and no new proposal can name it.
 *
 * **Still only an empty call**, even though nothing is destroyed any more. The
 * reason changed rather than went away: a deleted call with proposals in it
 * would leave those pitches pointing at something the committee can no longer
 * see or decide on, while their authors go on reading the call's name in their
 * own list. Hiding the container of live work is its own kind of loss.
 *
 * The `not exists` travels in the statement, so a proposal arriving between a
 * read and this write cannot have its call vanish underneath it. `deleted_at
 * is null` makes a second click harmless and keeps the first deletion's
 * instant, the same reasoning as `close()`.
 */
export async function remove(id: string): Promise<boolean> {
	const result = await db
		.update(cfp)
		.set({ deletedAt: new Date() })
		.where(
			and(
				eq(cfp.id, id),
				isNull(cfp.deletedAt),
				notExists(
					db.select({ one: sql`1` }).from(proposal).where(eq(proposal.cfpId, id)),
				),
			),
		);

	return changed(result) === 1;
}

/**
 * Put a deleted call back.
 *
 * It returns in the state it left in: `closes_at` was never touched, so a call
 * deleted while closed comes back closed, and one deleted while open comes
 * back taking submissions — and back on the homepage, which is the part worth
 * pausing over before clicking it.
 *
 * `deleted_at is not null` is the guard, so restoring a call that is already
 * live changes nothing rather than stamping `updated_at` for no reason.
 */
export async function restore(id: string): Promise<boolean> {
	const result = await db
		.update(cfp)
		.set({ deletedAt: null })
		.where(and(eq(cfp.id, id), isNotNull(cfp.deletedAt)));

	return changed(result) === 1;
}

/**
 * Stop a call taking new submissions, as of now.
 *
 * Closing stops new submissions and nothing else: what is already in the call
 * is still reviewed, still decided, still scheduled, and still editable by its
 * author. Nothing is reassigned and nothing is archived.
 *
 * The `closes_at is null or closes_at > now` guard is what makes a second
 * click harmless. Without it a double-submitted form would push the closing
 * instant forward each time, so a call that shut in August would read as
 * having shut today — the deadline is the record of when submissions stopped,
 * and a reload must not rewrite it. Matching zero rows here means it was
 * already closed, which is less a failure than an answer.
 */
export async function close(id: string): Promise<boolean> {
	const now = new Date();

	const result = await db
		.update(cfp)
		.set({ closesAt: now })
		.where(and(eq(cfp.id, id), takingSubmissions(now)));

	return changed(result) === 1;
}
