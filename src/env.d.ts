/// <reference types="astro/client" />

declare namespace App {
	interface Locals {
		/** Set by middleware on server-rendered routes; null when signed out. */
		user: import('./lib/auth').User | null;
		session: import('./lib/auth').Session | null;
	}
}
