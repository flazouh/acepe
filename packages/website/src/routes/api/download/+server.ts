import { error, redirect } from "@sveltejs/kit";
import type { RequestHandler } from "./$types";

const GITHUB_RELEASES_API_URL = "https://api.github.com/repos/flazouh/acepe/releases/latest";
const GITHUB_RELEASES_LATEST_URL = "https://github.com/flazouh/acepe/releases/latest";

export const GET: RequestHandler = async ({ url }) => {
	const arch = url.searchParams.get("arch");

	if (!arch || !["aarch64", "x64"].includes(arch)) {
		throw error(400, "Invalid architecture. Use ?arch=aarch64 or ?arch=x64");
	}

	const res = await fetch(GITHUB_RELEASES_API_URL, {
		headers: { Accept: "application/vnd.github+json" },
	}).catch(() => null);

	if (!res || !res.ok) {
		throw redirect(302, GITHUB_RELEASES_LATEST_URL);
	}

	const release = (await res.json()) as {
		assets: { name: string; browser_download_url: string }[];
	};

	const asset = release.assets.find((a) => a.name.endsWith(".dmg") && a.name.includes(arch));

	if (!asset) {
		throw redirect(302, GITHUB_RELEASES_LATEST_URL);
	}

	throw redirect(302, asset.browser_download_url);
};
