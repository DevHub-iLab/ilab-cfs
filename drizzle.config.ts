import { defineConfig } from 'drizzle-kit';

/**
 * drizzle-kit generates the SQL; `wrangler d1 migrations apply` applies it, for
 * every environment. `out` is wrangler's `migrations_dir`, so there is one
 * migration stream and one apply path.
 *
 * Never run `drizzle-kit push` against a deployed database — it skips the
 * migration files entirely. No `dbCredentials` is configured here, so `push`
 * and `studio` simply cannot reach a database.
 */
export default defineConfig({
	schema: './src/db/schema.ts',
	out: './migrations',
	dialect: 'sqlite',
});
