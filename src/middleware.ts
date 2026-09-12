import { defineMiddleware } from 'astro:middleware';
import { auth } from './lib/auth';
import { ROLES, type Role } from './lib/auth-options';

/**
 * Roles are ranked, so a rule names the *minimum* role that satisfies it.
 * Admins review; reviewers are also speakers. The overlap is deliberate —
 * committee members pitch workshops as well as review them.
 */
const RANK: Record<Role, number> = { speaker: 0, reviewer: 1, admin: 2 };

/**
 * Access lives here rather than per-page, so a new route under one of these
 * prefixes is protected the moment it is created rather than the moment
 * someone remembers to guard it.
 */
const RULES: ReadonlyArray<readonly [prefix: string, minimum: Role]> = [
	['/admin', 'admin'],
	['/review', 'reviewer'],
	['/proposals', 'speaker'],
	['/account', 'speaker'],
];

function isRole(value: unknown): value is Role {
	return typeof value === 'string' && (ROLES as readonly string[]).includes(value);
}

export const onRequest = defineMiddleware(async (context, next) => {
	// Prerendered routes are rendered at build time, where no bindings exist.
	// Touching the database there would break the build, and there is no
	// visitor to authenticate anyway.
	if (context.isPrerendered) return next();

	// Better Auth's own endpoints must stay reachable while signed out.
	if (context.url.pathname.startsWith('/api/auth/')) return next();

	const session = await auth.api.getSession({ headers: context.request.headers });

	context.locals.user = session?.user ?? null;
	context.locals.session = session?.session ?? null;

	const rule = RULES.find(([prefix]) => context.url.pathname.startsWith(prefix));
	if (!rule) return next();

	if (!session) {
		const signIn = new URL('/sign-in', context.url);
		signIn.searchParams.set('redirect', context.url.pathname + context.url.search);
		return context.redirect(signIn.pathname + signIn.search);
	}

	// A user row predating the role column, or holding anything unrecognised,
	// is treated as the least privileged role rather than waved through.
	const role: Role = isRole(session.user.role) ? session.user.role : 'speaker';

	if (RANK[role] < RANK[rule[1]]) {
		return new Response('Forbidden', { status: 403 });
	}

	return next();
});
