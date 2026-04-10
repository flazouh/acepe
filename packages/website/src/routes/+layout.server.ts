import { dev } from "$app/environment";
import { getFeatureFlags } from "$lib/server/feature-flags";
import type { LayoutServerLoad } from "./$types";

async function getGitHubStars(): Promise<number | null> {
	const res = await fetch("https://api.github.com/repos/flazouh/acepe", {
		headers: { Accept: "application/vnd.github+json" },
	});
	if (!res.ok) return null;
	const data = (await res.json()) as { stargazers_count?: number };
	return data.stargazers_count ?? null;
}

export const load: LayoutServerLoad = async () => {
	const [featureFlagsResult, stars] = await Promise.all([getFeatureFlags(), getGitHubStars()]);

	// Use fallback values if feature flags fail to load
	const featureFlags = featureFlagsResult.isOk()
		? featureFlagsResult.value
		: {
				loginEnabled: false,
				downloadEnabled: false,
				roadmapEnabled: false,
			};

	// In dev mode, always enable download
	if (dev) {
		featureFlags.downloadEnabled = true;
	}

	return {
		featureFlags,
		githubStars: stars,
	};
};
