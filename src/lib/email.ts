import { env } from 'cloudflare:workers';
import type { SendEmail } from './auth-options';

/** Nobody reads replies to this address, so every message ends at a link. */
const FROM = 'iLab Call for Speakers <no-reply@ilabccds.com>';

const RESEND_ENDPOINT = 'https://api.resend.com/emails';

/**
 * The one place a provider is named. Better Auth just calls this, so swapping
 * Resend out is a change to this function and nothing else.
 *
 * Auth mail is sent directly rather than through the `notification` queue:
 * it is user-triggered rather than bursty, and queueing it would put magic
 * links in our database.
 */
export const sendEmail: SendEmail = async ({ to, subject, text }) => {
	const apiKey = env.RESEND_API_KEY;

	if (!apiKey) {
		// Local development without a key: print the message so magic links are
		// followable from the terminal. Deployed, this branch means mail is
		// misconfigured, so it must read as a failure rather than a success.
		console.warn(
			`[email] RESEND_API_KEY is not set — not sending "${subject}" to ${to}.`,
		);
		console.info(text);
		return;
	}

	const response = await fetch(RESEND_ENDPOINT, {
		method: 'POST',
		headers: {
			Authorization: `Bearer ${apiKey}`,
			'Content-Type': 'application/json',
		},
		body: JSON.stringify({ from: FROM, to, subject, text }),
	});

	if (!response.ok) {
		// Let the caller fail loudly: a speaker who is told "check your email"
		// when nothing was sent has no way to recover.
		throw new Error(
			`Resend rejected the message (${response.status}): ${await response.text()}`,
		);
	}
};
