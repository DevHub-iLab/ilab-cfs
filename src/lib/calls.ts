import { and, eq, gt, isNull, or } from 'drizzle-orm';
import { changed, db } from '../db';
import { cfp, TRACKS, type Track } from '../db/schema';

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
 * Both writes are one statement with an assertion on `meta.changes`, the same
 * shape as `proposals.ts` and for the same reason: D1 runs in auto-commit and
 * has no interactive transactions, so a guard has to travel with the statement
 * it guards rather than sitting in a read before it. Neither needs `batch()` —
 * there is no second row to keep in step, and there will not be one until
 * `audit_log` exists.
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

/** What an admin filled in. `closesAt: null` is a call that never closes. */
export interface CallDraft {
	name: string;
	track: Track;
	description: string | null;
	closesAt: Date | null;
}

/** Why a submitted form was refused. The page words each one. */
export type CallProblem = 'name' | 'track' | 'closes' | 'past';

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
 */
export function readCallForm(form: FormData): { call: CallDraft } | { problem: CallProblem } {
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

	// A call created already shut would take no submissions and never appear on
	// the homepage — it is a typo, not a request.
	if (closesAt.getTime() <= Date.now()) return { problem: 'past' };

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
		.where(and(eq(cfp.id, id), or(isNull(cfp.closesAt), gt(cfp.closesAt, now))));

	return changed(result) === 1;
}
