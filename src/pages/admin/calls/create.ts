import type { APIRoute } from 'astro';
import { create, readCallForm } from '../../../lib/calls';

export const prerender = false;

/**
 * Hand back what was typed, so a refusal costs an admin a click rather than
 * the blurb they wrote. None of it is sensitive — it is what they were about
 * to publish on the homepage.
 */
function back(form: FormData, problem: string): string {
	const params = new URLSearchParams({ error: problem });

	for (const field of ['name', 'track', 'description', 'kind', 'closes-at']) {
		const value = String(form.get(field) ?? '').trim();
		if (value) params.set(field, value);
	}

	return `/admin/calls?${params}`;
}

/**
 * Open a call.
 *
 * Middleware guards the whole `/admin` prefix, so this is reached by an admin
 * or not at all; the check below is deliberate belt and braces on a write that
 * changes what the front page advertises, and costs one comparison.
 *
 * The answer is a redirect rather than a rendered page — POST, redirect, GET —
 * so a reload never offers to create the same call twice.
 */
export const POST: APIRoute = async ({ request, locals, redirect }) => {
	if (locals.user?.role !== 'admin') return new Response('Forbidden', { status: 403 });

	const form = await request.formData();
	const read = readCallForm(form);

	if ('problem' in read) return redirect(back(form, read.problem));

	await create(read.call);

	return redirect('/admin/calls?created=1');
};
