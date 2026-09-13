import type { APIRoute } from 'astro';
import { missingForSubmission, readContent, save, submit } from '../../../lib/proposals';

export const prerender = false;

/**
 * Save a proposal, and submit it if that is what was asked.
 *
 * The order matters and is the whole reason these are two statements rather
 * than one: the edit is saved first and unconditionally, because an author may
 * edit a proposal in a call that has already closed. Submitting is attempted
 * afterwards and may be refused. A speaker who misses the deadline by a second
 * keeps their words and loses only the submission.
 */
export const POST: APIRoute = async ({ params, request, locals, redirect }) => {
	const user = locals.user;
	const id = params.id!;
	if (!user) return redirect(`/sign-in?redirect=/proposals/${id}`);

	const form = await request.formData();
	const content = readContent(form);
	const wantsSubmit = form.get('intent') === 'submit';

	// Ownership is enforced inside the statement; a miss is someone else's
	// proposal or none at all, and both get the same answer.
	const saved = await save({ id, speakerId: user.id, content });
	if (!saved) return new Response('Not found', { status: 404 });

	if (!wantsSubmit) return redirect(`/proposals/${id}?saved=1`);

	const missing = missingForSubmission(content);
	if (missing) return redirect(`/proposals/${id}?error=${!content.title ? 'title' : 'abstract'}`);

	const result = await submit({ id, speakerId: user.id });
	if (!result.ok) return redirect(`/proposals/${id}?error=${result.reason}`);

	return redirect(`/proposals/${id}?submitted=1`);
};
