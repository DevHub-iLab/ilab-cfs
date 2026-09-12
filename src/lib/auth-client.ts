import { createAuthClient } from 'better-auth/client';
import { magicLinkClient } from 'better-auth/client/plugins';

/**
 * Browser-side auth. Astro ships no UI framework here, so this is the vanilla
 * client rather than the React/Svelte ones.
 *
 * No `baseURL`: the client defaults to the origin it was served from, which is
 * what we want on every environment. Server-side code should not use this —
 * read `Astro.locals.user`, which middleware has already resolved.
 *
 *   import { signIn } from '../lib/auth-client';
 *   await signIn.magicLink({ email, callbackURL: '/proposals' });
 */
export const authClient = createAuthClient({
	plugins: [magicLinkClient()],
});

export const { signIn, signOut, useSession, getSession } = authClient;
