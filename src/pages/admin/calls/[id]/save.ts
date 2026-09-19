import type { APIRoute } from 'astro';
import { readCallForm, update } from '../../../../lib/calls';

export const prerender = false;

/** Hand back what was typed, so a refusal costs a click rather than the blurb. */
function back(id: string, form: FormData, problem: string): string {
	const params = new URLSearchParams({ error: problem });

	for (const field of ['name', 'track', 'description', 'kind', 'closes-at']) {
		const value = String(form.get(field) ?? '').trim();
		if (value) params.set(field, value);
	}

	return `/admin/calls/${id}?${params}`;
}

/**
 * Change a call.
 *
 * `allowPast` is the one difference from creating one: a deadline already
 * behind us is what every closed call has, so refusing it would mean a closed
 * call could never be renamed. It is also how a call is closed retroactively,
 * and how moving the date forward reopens one.
 *
 * The field speaks minutes, so saving a call that was closed by the button at
 * 15:18:07 rewrites that to 15:18:00. The screens render to the minute and
 * nothing reads the seconds, so the truncation is left rather than carried
 * around in a hidden field.
 */
export const POST: APIRoute = async ({ params, request, locals, redirect }) => {
	if (locals.user?.role !== 'admin') return new Response('Forbidden', { status: 403 });

	const id = params.id!;
	const form = await request.formData();
	const read = readCallForm(form, { allowPast: true });

	if ('problem' in read) return redirect(back(id, form, read.problem));

	// Ownership is not a question here — every admin owns every call — so the
	// only thing a miss can mean is that there is no such call.
	const saved = await update(id, read.call);
	if (!saved) return new Response('Not found', { status: 404 });

	return redirect(`/admin/calls/${id}?saved=1`);
};
