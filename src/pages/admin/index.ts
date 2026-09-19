import type { APIRoute } from 'astro';

export const prerender = false;

/**
 * The admin root, until there is a console to put here.
 *
 * Calls are the only admin screen that exists, so `/admin` leads there rather
 * than 404ing at someone who typed the obvious URL. When the console (artboard
 * 1f) lands it takes this route and the redirect goes.
 */
export const GET: APIRoute = ({ redirect }) => redirect('/admin/calls');
