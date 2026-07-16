import type { Handle } from "@sveltejs/kit";
import { sequence } from "@sveltejs/kit/hooks";
import { env } from "$env/dynamic/private";
import { getLegacyLocaleRedirectPath } from "$lib/locale-routing";
import { maybeGetDatabaseUrl } from "$lib/server/db/database-url";
import { runMigrations } from "$lib/server/db/migrate";
import { logger } from "$lib/server/logger";

// Skip startup migrations during local pitch export preview.
if (env.ACEPE_PITCH_EXPORT !== "1" && maybeGetDatabaseUrl()) {
	runMigrations().catch((err) => {
		logger.error({ err }, "Failed to run database migrations");
	});
}

const BOT_PATTERNS = [
	/\/wp-admin\//,
	/\/wordpress\//,
	/\/xmlrpc\.php/,
	/\/wp-login\.php/,
	/\/phpmyadmin/,
	/\/admin\/config\.php/,
	/\.env$/,
	/\.git\//,
];

const IGNORE_404_PATHS = [
	"/sw.js",
	"/service-worker.js",
	"/manifest.json",
	"/robots.txt",
	"/favicon.ico",
];

/** Old favicon paths → /brand/* so sticky Chrome/CF caches cannot keep the prior mark. */
const FAVICON_REDIRECTS: Record<string, string> = {
	"/favicon.ico": "/brand/acepe-mark.ico",
	"/favicon.svg": "/brand/acepe-mark.svg",
	"/favicon-16x16.png": "/brand/acepe-mark-16.png",
	"/favicon-32x32.png": "/brand/acepe-mark-32.png",
	"/favicon-192x192.png": "/brand/acepe-mark-192.png",
	"/favicon-512x512.png": "/brand/acepe-mark-512.png",
	"/apple-touch-icon.png": "/brand/acepe-mark-180.png",
};

const CORS_HEADERS = {
	"Access-Control-Allow-Origin": "*",
	"Access-Control-Allow-Methods": "GET, POST, PATCH, PUT, DELETE, OPTIONS",
	"Access-Control-Allow-Headers": "Content-Type, Authorization",
	"Access-Control-Max-Age": "86400",
} as const;

const handleCors: Handle = async ({ event, resolve }) => {
	const path = event.url.pathname;
	const isApi = path.startsWith("/api/");

	if (isApi && event.request.method === "OPTIONS") {
		return new Response(null, { status: 204, headers: CORS_HEADERS });
	}

	const response = await resolve(event);

	if (isApi && response.headers.get("Access-Control-Allow-Origin") === null) {
		const headers = new Headers(response.headers);
		for (const [key, value] of Object.entries(CORS_HEADERS)) {
			headers.set(key, value);
		}
		return new Response(response.body, {
			status: response.status,
			statusText: response.statusText,
			headers,
		});
	}

	return response;
};

const handleBotFilter: Handle = async ({ event, resolve }) => {
	const path = event.url.pathname;

	if (BOT_PATTERNS.some((pattern) => pattern.test(path))) {
		return new Response(null, { status: 404 });
	}

	const response = await resolve(event);

	if (response.status === 404 && !IGNORE_404_PATHS.includes(path)) {
		logger.warn({ path, method: event.request.method }, `[404] ${event.request.method} ${path}`);
	}

	return response;
};

const handleLegacyLocaleRedirect: Handle = async ({ event, resolve }) => {
	const redirectPath = getLegacyLocaleRedirectPath(event.url);

	if (redirectPath !== null) {
		return new Response(null, {
			status: 308,
			headers: {
				Location: redirectPath,
			},
		});
	}

	return resolve(event);
};

const handleFaviconRedirect: Handle = async ({ event, resolve }) => {
	const target = FAVICON_REDIRECTS[event.url.pathname];
	if (target !== undefined) {
		return new Response(null, {
			status: 302,
			headers: {
				Location: target,
				"Cache-Control": "no-store",
			},
		});
	}

	return resolve(event);
};

export const handle: Handle = sequence(
	handleCors,
	handleFaviconRedirect,
	handleLegacyLocaleRedirect,
	handleBotFilter,
);
