/**
 * Auth configuration that shapes the database schema.
 *
 * This module must stay free of `cloudflare:workers` imports: the Better Auth
 * CLI loads it under Node to regenerate `src/db/auth-schema.ts` (see
 * `auth.config.ts`). Anything needing a binding — the adapter, the KV session
 * cache, secrets, OAuth providers — lives in `src/lib/auth.ts` instead.
 */
import { magicLink } from 'better-auth/plugins';
import type { BetterAuthOptions } from 'better-auth';

/** Roles live in D1 and are enforced in middleware. */
export const ROLES = ['speaker', 'reviewer', 'admin'] as const;
export type Role = (typeof ROLES)[number];

export interface EmailMessage {
	to: string;
	subject: string;
	text: string;
}

export type SendEmail = (message: EmailMessage) => Promise<void>;

/**
 * Returns the literal options type rather than a widened `BetterAuthOptions`
 * — `satisfies` type-checks the shape while keeping `additionalFields` intact,
 * which is what lets `session.user.role` survive into the inferred types.
 * Annotating the return type instead erases it.
 */
export function authOptions(sendEmail: SendEmail) {
	return {
		appName: 'iLab Call for Speakers',

		user: {
			additionalFields: {
				role: {
					type: 'string',
					required: false,
					defaultValue: 'speaker' satisfies Role,
					// Load-bearing: without `input: false` the role is accepted
					// from the sign-up payload, and anyone could mint themselves
					// an admin account. Roles are granted by an admin, never
					// self-declared.
					input: false,
				},
			},
		},

		// Sign-in is passwordless — a call for speakers has to be frictionless
		// for people outside the lab.
		emailAndPassword: { enabled: false },

		session: {
			// Reads come from KV first. On a KV miss Better Auth only falls back
			// to D1 when this is true, which is the fix for the issue where an
			// elapsed secondaryStorage TTL silently logged users out
			// (better-auth#4203, re-confirmed against 1.7.4's `findSession`).
			//
			// Do NOT add `preserveSessionInDatabase: true` alongside it — that
			// flag is part of the same condition and puts the logout bug back,
			// because a KV miss would then return null rather than reading D1.
			storeSessionInDatabase: true,
		},

		verification: {
			// With a secondaryStorage configured, verification records — which
			// is where magic-link tokens live — default to KV *only*. That
			// breaks the rule that nothing in KV is authoritative, and makes a
			// link's validity depend on KV's eventual consistency. Keep them in
			// D1.
			storeInDatabase: true,
		},

		rateLimit: {
			// Defaults to `isProduction`, which Better Auth derives from
			// NODE_ENV — unset on Workers, so rate limiting would be off in
			// production. Enable it explicitly.
			enabled: true,
			// Defaults to "secondary-storage" whenever one is configured, but
			// KV has no atomic increment, so limits would be undercounted under
			// concurrency. D1 is authoritative and has one.
			storage: 'database',
		},

		plugins: [
			magicLink({
				// 15 minutes, not the 5 minute default: the sign-in screen and
				// the mail both promise 15, and a link that dies before the
				// mail is read is the whole failure mode. Changing it means
				// changing the copy in `src/pages/sign-in.astro` too.
				expiresIn: 60 * 15,
				// Only the hash is stored; the mailed token stays out of D1.
				storeToken: 'hashed',
				sendMagicLink: async ({ email, url }) => {
					await sendEmail({
						to: email,
						subject: 'Your sign-in link for iLab CFS',
						text: [
							"Here's your link. It signs you in once and stops working",
							'after 15 minutes.',
							'',
							url,
							'',
							"Didn't ask for this? Ignore it — nobody can sign in",
							'without opening the link.',
							'',
							"This mailbox isn't monitored.",
						].join('\n'),
					});
				},
			}),
		],
	} satisfies BetterAuthOptions;
}
