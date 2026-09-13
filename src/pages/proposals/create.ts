import type { APIRoute } from 'astro';
import { create, missingForSubmission, readContent } from '../../lib/proposals';

export const prerender = false;

/**
 * Create a proposal.
 *
 * Astro checks the Origin header on on-demand POSTs by default, and middleware
 * has already required a signed-in user for anything under `/proposals`, so
 * this handler is left with the two questions that are actually its own: is
 * the form complete enough for what was asked, and is the call still open.
 *
 * Answers come back as a redirect rather than a rendered page — POST, redirect,
 * GET — so a reload never offers to submit the proposal twice.
 */
export const POST: APIRoute = async ({ request, locals, redirect }) => {
	const user = locals.user;
	if (!user) return redirect('/sign-in?redirect=/proposals/new');

	const form = await request.formData();
	const cfpId = String(form.get('cfp') ?? '');
	const content = readContent(form);
	const wantsSubmit = form.get('intent') === 'submit';

	if (!cfpId) return redirect('/proposals/new?error=closed');

	if (wantsSubmit) {
		const missing = missingForSubmission(content);
		// Nothing is written on an incomplete submit: there is no half-made
		// proposal to recover, so sending them back to the form loses nothing.
		if (missing) return redirect(`/proposals/new?error=${!content.title ? 'title' : 'abstract'}`);
	}

	const created = await create({ speakerId: user.id, cfpId, content });
	if ('error' in created) return redirect('/proposals/new?error=closed');

	// Drafts and submissions are both created as drafts, then submitted. The
	// window guard lives on that second step, so both paths meet it.
	if (wantsSubmit) {
		const { submit } = await import('../../lib/proposals');
		const result = await submit({ id: created.id, speakerId: user.id });
		if (!result.ok) return redirect(`/proposals/${created.id}?error=${result.reason}`);
		return redirect(`/proposals/${created.id}?submitted=1`);
	}

	return redirect(`/proposals/${created.id}?saved=1`);
};
