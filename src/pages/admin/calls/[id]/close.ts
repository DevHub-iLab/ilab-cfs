import type { APIRoute } from 'astro';
import { backToCalls, close } from '../../../../lib/calls';

export const prerender = false;

/**
 * Close a call, as of now.
 *
 * The window guard travels in the statement, so a miss is a call that was
 * already closed — or one that never existed, and both get the same answer.
 * Nothing is deleted and nothing is reassigned: the proposals already pitched
 * to it stay where they were pitched.
 */
export const POST: APIRoute = async ({ params, request, locals, redirect }) => {
	if (locals.user?.role !== 'admin') return new Response('Forbidden', { status: 403 });

	const done = await close(params.id!);

	return redirect(backToCalls(request, done ? { closed: '1' } : { error: 'close' }));
};
