import { drizzle } from 'drizzle-orm/d1';
import { env } from 'cloudflare:workers';
import * as schema from './schema';

/**
 * D1 is the system of record.
 *
 * `env` is a module-scope import rather than a per-request value, so bindings
 * never have to be threaded down from the request.
 *
 * Note for anything built on top of this: D1 has no interactive transactions.
 * `db.transaction()` type-checks but emits `begin`/`commit` that the binding
 * ignores — it fails silently. Use `db.batch()`.
 */
export const db = drizzle(env.DB, { schema });

export type Database = typeof db;

/**
 * How many rows a write changed.
 *
 * D1 reports affected rows on `meta.changes`, and Drizzle passes its result
 * through untouched, so one reader serves both a Drizzle builder and a raw
 * statement handed to the binding. Every guarded write asserts on this: a
 * statement whose WHERE matched nothing is a *successful* statement, so the
 * count is the only thing that says whether the guard let the write through.
 */
export function changed(result: { meta?: { changes?: number } }): number {
	return result?.meta?.changes ?? 0;
}
