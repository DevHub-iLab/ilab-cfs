import type { APIRoute } from 'astro';
import { backToCalls, remove } from '../../../../lib/calls';

export const prerender = false;

/**
 * Delete a call.
 *
 * Only ever an empty one — the statement refuses a call anything was pitched
 * to, and a miss here means either that or no such call. Both get the same
 * answer, since neither is something an admin can act on differently.
 */
export const POST: APIRoute = async ({ params, request, locals, redirect }) => {
	if (locals.user?.role !== 'admin') return new Response('Forbidden', { status: 403 });

	const done = await remove(params.id!);

	return redirect(backToCalls(request, done ? { deleted: '1' } : { error: 'delete' }));
};
