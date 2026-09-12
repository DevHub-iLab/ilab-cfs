/**
 * The one schema, feeding the one migration stream.
 *
 * Better Auth owns `auth-schema.ts` and regenerates it wholesale — never hand
 * edit that file. Application tables (cfp, event, proposal, …) are added here
 * as they are built.
 */
export * from './auth-schema';
