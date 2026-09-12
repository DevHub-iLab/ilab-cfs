import type { APIRoute } from 'astro';
import { auth } from '../../../lib/auth';

// Without this the route ships as a build-time snapshot instead of running.
export const prerender = false;

/** Better Auth speaks web-standard Request/Response, so it mounts directly. */
export const ALL: APIRoute = ({ request }) => auth.handler(request);
