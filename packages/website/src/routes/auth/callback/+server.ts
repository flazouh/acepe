import { error, redirect } from "@sveltejs/kit";
import { env } from "$env/dynamic/private";
import { createSession, findOrCreateUserByGoogle } from "$lib/server/auth/admin";
import type { RequestHandler } from "./$types";

interface GoogleTokenResponse {
	access_token: string;
	id_token: string;
	token_type: string;
	expires_in: number;
}

interface GoogleUserInfo {
	sub: string;
	email: string;
	email_verified: boolean;
	name: string;
	picture: string;
}

export const GET: RequestHandler = async ({ url, cookies }) => {
	const code = url.searchParams.get("code");
	const state = url.searchParams.get("state");
	const storedState = cookies.get("oauth_state");

	// Clear the state cookie
	cookies.delete("oauth_state", { path: "/" });

	// Validate state
	if (!state || state !== storedState) {
		throw error(400, "Invalid state parameter");
	}

	if (!code) {
		throw error(400, "Missing authorization code");
	}

	const clientId = env.GOOGLE_CLIENT_ID;
	const clientSecret = env.GOOGLE_CLIENT_SECRET;
	const redirectUri = `${url.origin}/auth/callback`;

	if (!clientId || !clientSecret) {
		throw error(500, "Google OAuth is not configured");
	}

	// Exchange code for tokens
	const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
		method: "POST",
		headers: {
			"Content-Type": "application/x-www-form-urlencoded",
		},
		body: new URLSearchParams({
			code,
			client_id: clientId,
			client_secret: clientSecret,
			redirect_uri: redirectUri,
			grant_type: "authorization_code",
		}),
	});

	if (!tokenResponse.ok) {
		throw error(400, "Failed to exchange authorization code");
	}

	const tokens: GoogleTokenResponse = await tokenResponse.json();

	// Get user info
	const userInfoResponse = await fetch("https://www.googleapis.com/oauth2/v3/userinfo", {
		headers: {
			Authorization: `Bearer ${tokens.access_token}`,
		},
	});

	if (!userInfoResponse.ok) {
		throw error(400, "Failed to get user info");
	}

	const userInfo: GoogleUserInfo = await userInfoResponse.json();

	// Find or create user
	const userResult = await findOrCreateUserByGoogle({
		googleId: userInfo.sub,
		email: userInfo.email,
		name: userInfo.name,
		picture: userInfo.picture,
	});

	if (userResult.isErr()) {
		throw error(500, userResult.error.message);
	}

	// Create session
	const sessionResult = await createSession(userResult.value.id);

	if (sessionResult.isErr()) {
		throw error(500, "Failed to create session");
	}

	// Set session cookie
	cookies.set("session", sessionResult.value.id, {
		path: "/",
		httpOnly: true,
		secure: process.env.NODE_ENV === "production",
		sameSite: "lax",
		maxAge: 60 * 60 * 24 * 7, // 7 days
	});

	// Redirect to admin if user is admin, otherwise to home
	if (userResult.value.isAdmin) {
		throw redirect(303, "/admin");
	}

	throw redirect(303, "/");
};
