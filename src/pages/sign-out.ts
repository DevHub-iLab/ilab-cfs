import type { APIRoute } from 'astro';
import { auth } from '../lib/auth';

export const prerender = false;

/**
 * Sign out, then land somewhere.
 *
 * Better Auth's own endpoint answers in JSON, which is the wrong shape for a
 * plain form: submitting to it directly leaves the browser looking at
 * `{"success":true}`. This asks for the full response so the cookie-clearing
 * `Set-Cookie` comes with it, and re-sends those headers on a redirect instead.
 *
 * A POST because it changes something — a link that signs you out is a link
 * anything can follow on your behalf. Astro's origin check covers the rest.
 */
export const POST: APIRoute = async ({ request }) => {
	const signedOut = await auth.api.signOut({ headers: request.headers, asResponse: true });

	const headers = new Headers(signedOut.headers);
	headers.delete('content-type');
	headers.delete('content-length');
	// 303, not 302: the browser must follow it with GET rather than repeating
	// the POST at the new location.
	headers.set('Location', '/');

	return new Response(null, { status: 303, headers });
};
