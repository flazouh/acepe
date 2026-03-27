import { error, redirect } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ url }) => {
	const arch = url.searchParams.get('arch');

	if (!arch || !['aarch64', 'x64'].includes(arch)) {
		throw error(400, 'Invalid architecture. Use ?arch=aarch64 or ?arch=x64');
	}

	const res = await fetch('https://api.github.com/repos/flazouh/acepe/releases/latest', {
		headers: { Accept: 'application/vnd.github+json' }
	});

	if (!res.ok) {
		throw error(502, 'Failed to fetch latest release from GitHub');
	}

	const release = (await res.json()) as { assets: { name: string; browser_download_url: string }[] };

	const asset = release.assets.find(
		(a) => a.name.endsWith('.dmg') && a.name.includes(arch)
	);

	if (!asset) {
		throw error(404, `No .dmg asset found for arch: ${arch}`);
	}

	throw redirect(302, asset.browser_download_url);
};
