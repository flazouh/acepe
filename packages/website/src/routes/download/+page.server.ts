import { dev } from '$app/environment';
import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

async function getLatestVersion(): Promise<string | null> {
	const res = await fetch('https://api.github.com/repos/flazouh/acepe/releases/latest', {
		headers: { Accept: 'application/vnd.github+json' }
	});

	if (!res.ok) return null;

	const data = (await res.json()) as { tag_name?: string };
	// tag_name is like "v2026.3.30" — strip the leading "v"
	return data.tag_name ? data.tag_name.replace(/^v/, '') : null;
}

export const load: PageServerLoad = async ({ parent }) => {
	const { featureFlags } = await parent();

	if (!dev && !featureFlags.downloadEnabled) {
		throw redirect(302, '/');
	}

	const version = await getLatestVersion();

	return { version };
};
