import type { APIRoute } from 'astro';
import { backToCalls, restore } from '../../../../lib/calls';

export const prerender = false;

/**
 * Put a deleted call back.
 *
 * It returns exactly as it left — `closes_at` was never touched — so a call
 * deleted while open is taking submissions again the moment this returns, and
 * back on the homepage with it.
 */
export const POST: APIRoute = async ({ params, request, locals, redirect }) => {
	if (locals.user?.role !== 'admin') return new Response('Forbidden', { status: 403 });

	const done = await restore(params.id!);

	return redirect(backToCalls(request, done ? { restored: '1' } : { error: 'restore' }));
};
