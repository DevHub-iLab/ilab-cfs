import { betterAuth } from 'better-auth';
import { drizzleAdapter } from '@better-auth/drizzle-adapter';
import { env } from 'cloudflare:workers';
import { db } from '../db';
import { authOptions } from './auth-options';
import { sendEmail } from './email';

/**
 * KV as a pure session cache. Nothing here is authoritative: with
 * `storeSessionInDatabase` set, every value is reconstructible from D1.
 *
 * Cloudflare KV enforces a 60 second floor on `expirationTtl` and rejects
 * anything shorter, so short TTLs are raised rather than passed through.
 */
const kvSessionCache = {
	get: (key: string) => env.AUTH_KV.get(key),

	set: async (key: string, value: string, ttl?: number) => {
		await env.AUTH_KV.put(
			key,
			value,
			ttl ? { expirationTtl: Math.max(60, Math.floor(ttl)) } : undefined,
		);
	},

	delete: (key: string) => env.AUTH_KV.delete(key),

	// KV has no atomic get-and-delete. This is only reached for verification
	// records held in KV, and `verification.storeInDatabase` keeps those in D1,
	// so the non-atomic pair is never on a live path.
	getAndDelete: async (key: string) => {
		const value = await env.AUTH_KV.get(key);
		if (value !== null) await env.AUTH_KV.delete(key);
		return value;
	},

	// KV cannot increment atomically, so a counter built on it undercounts
	// under concurrency — which in a rate limiter means the limit does not
	// hold. Rate limiting is configured against D1 instead; this throwing
	// rather than approximating is what keeps a later switch to
	// `rateLimit.storage: "secondary-storage"` from silently weakening it.
	increment: (): never => {
		throw new Error(
			'KV cannot increment atomically. Rate limiting must stay on `storage: "database"`.',
		);
	},
};

/** Only wire a provider once its credentials actually exist. */
function socialProviders() {
	const configured: Record<string, { clientId: string; clientSecret: string }> = {};

	const candidates = {
		google: [env.GOOGLE_CLIENT_ID, env.GOOGLE_CLIENT_SECRET],
		github: [env.GITHUB_CLIENT_ID, env.GITHUB_CLIENT_SECRET],
		linkedin: [env.LINKEDIN_CLIENT_ID, env.LINKEDIN_CLIENT_SECRET],
	} as const;

	for (const [provider, [clientId, clientSecret]] of Object.entries(candidates)) {
		if (clientId && clientSecret) configured[provider] = { clientId, clientSecret };
	}

	return configured;
}

export const auth = betterAuth({
	...authOptions(sendEmail),

	database: drizzleAdapter(db, { provider: 'sqlite' }),
	secondaryStorage: kvSessionCache,

	// Worker secrets arrive on the `env` binding, and Better Auth only reads
	// env vars from `process.env`/Deno/Bun — none of which exist here. Both of
	// these must be passed explicitly or they are silently undefined.
	secret: env.BETTER_AUTH_SECRET,
	baseURL: env.BETTER_AUTH_URL,

	socialProviders: socialProviders(),
});

export type Session = typeof auth.$Infer.Session.session;
export type User = typeof auth.$Infer.Session.user;
