/**
 * Schema-generation config for the Better Auth CLI. Not used at runtime.
 *
 * The CLI runs under Node, where `cloudflare:workers` cannot be imported and
 * no bindings exist, so it cannot load `src/lib/auth.ts`. It only needs the
 * options that shape tables plus the adapter's dialect, so the database is a
 * stub here — the generator never issues a query.
 *
 *   pnpm auth:generate   # rewrites src/db/auth-schema.ts
 *
 * Review the regenerated diff as a migration; never apply it blind.
 *
 * Running it prints "Drizzle schema mismatch — missing tables" and a base URL
 * warning. Both are expected: the stub below has no tables attached and no
 * origin. The runtime adapter in `src/lib/auth.ts` gets the real schema from
 * the Drizzle instance and stays quiet, which is how you can tell a genuine
 * mismatch from this noise.
 */
import { betterAuth } from 'better-auth';
import { drizzleAdapter } from '@better-auth/drizzle-adapter';
import { authOptions } from './src/lib/auth-options';

export const auth = betterAuth({
	...authOptions(async () => {}),
	database: drizzleAdapter({} as never, { provider: 'sqlite' }),
});
