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
