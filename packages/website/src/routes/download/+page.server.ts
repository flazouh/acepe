import type { PageServerLoad } from "./$types";

const GITHUB_RELEASES_API_URL = "https://api.github.com/repos/flazouh/acepe/releases/latest";
const GITHUB_RELEASES_BASE_URL = "https://github.com/flazouh/acepe/releases";

async function getLatestVersion(): Promise<string | null> {
	const res = await fetch(GITHUB_RELEASES_API_URL, {
		headers: { Accept: "application/vnd.github+json" },
	});

	if (!res.ok) return null;

	const data = (await res.json()) as { tag_name?: string };
	// tag_name is like "v2026.3.30" — strip the leading "v"
	return data.tag_name ? data.tag_name.replace(/^v/, "") : null;
}

function getDownloadUrl(version: string | null): string {
	if (!version) {
		return `${GITHUB_RELEASES_BASE_URL}/latest`;
	}

	return `${GITHUB_RELEASES_BASE_URL}/download/v${version}/Acepe_${version}_aarch64.dmg`;
}

export const load: PageServerLoad = async () => {
	const version = await getLatestVersion();

	return {
		version,
		downloadUrl: getDownloadUrl(version),
	};
};
