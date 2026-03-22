import { redirect } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { env } from '$env/dynamic/private';

export const GET: RequestHandler = async ({ url, cookies }) => {
	const clientId = env.GOOGLE_CLIENT_ID;
	const redirectUri = `${url.origin}/auth/callback`;

	if (!clientId) {
		throw new Error('GOOGLE_CLIENT_ID is not configured');
	}

	// Generate state for CSRF protection
	const state = crypto.randomUUID();
	cookies.set('oauth_state', state, {
		path: '/',
		httpOnly: true,
		secure: process.env.NODE_ENV === 'production',
		sameSite: 'lax',
		maxAge: 60 * 10 // 10 minutes
	});

	const params = new URLSearchParams({
		client_id: clientId,
		redirect_uri: redirectUri,
		response_type: 'code',
		scope: 'openid email profile',
		state,
		access_type: 'offline',
		prompt: 'consent'
	});

	throw redirect(302, `https://accounts.google.com/o/oauth2/v2/auth?${params}`);
};
