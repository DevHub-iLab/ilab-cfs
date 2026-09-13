import type { APIRoute } from 'astro';
import { remove } from '../../../lib/proposals';

export const prerender = false;

export const POST: APIRoute = async ({ params, locals, redirect }) => {
	const user = locals.user;
	const id = params.id!;
	if (!user) return redirect(`/sign-in?redirect=/proposals`);

	const done = await remove({ id, speakerId: user.id });
	return redirect(done ? '/proposals?deleted=1' : '/proposals?error=delete');
};
