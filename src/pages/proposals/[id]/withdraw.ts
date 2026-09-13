import type { APIRoute } from 'astro';
import { withdraw } from '../../../lib/proposals';

export const prerender = false;

export const POST: APIRoute = async ({ params, locals, redirect }) => {
	const user = locals.user;
	const id = params.id!;
	if (!user) return redirect(`/sign-in?redirect=/proposals`);

	// Ownership and the status guard both travel in the statement; a miss is
	// somebody else's proposal, or one that was never submitted.
	const done = await withdraw({ id, speakerId: user.id });
	return redirect(done ? '/proposals?withdrawn=1' : '/proposals?error=withdraw');
};
