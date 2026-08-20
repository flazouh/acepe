import { dev } from "$app/environment";
import { getFeatureFlags } from "$lib/server/feature-flags";
import * as Effect from "effect/Effect";
import * as Result from "effect/Result";
import type { LayoutServerLoad } from "./$types";

const defaultFeatureFlags = {
	loginEnabled: false,
	downloadEnabled: false,
	roadmapEnabled: false,
};

function shouldUsePitchStaticLayoutLoad(pathname: string): boolean {
	return pathname === "/pitch" || pathname.startsWith("/pitch/");
}

async function getGitHubStars(): Promise<number | null> {
	const res = await fetch("https://api.github.com/repos/flazouh/acepe", {
		headers: { Accept: "application/vnd.github+json" },
	});
	if (!res.ok) return null;
	const data = (await res.json()) as { stargazers_count?: number };
	return data.stargazers_count ?? null;
}

export const load: LayoutServerLoad = async ({ url }) => {
	if (shouldUsePitchStaticLayoutLoad(url.pathname)) {
		return {
			featureFlags: {
				loginEnabled: defaultFeatureFlags.loginEnabled,
				downloadEnabled: defaultFeatureFlags.downloadEnabled,
				roadmapEnabled: defaultFeatureFlags.roadmapEnabled,
			},
			githubStars: null,
		};
	}

	const [featureFlagsResult, stars] = await Promise.all([
		Effect.runPromise(Effect.result(getFeatureFlags())),
		getGitHubStars(),
	]);

	// Use fallback values if feature flags fail to load
	const featureFlags = Result.isSuccess(featureFlagsResult)
		? featureFlagsResult.success
		: {
				loginEnabled: defaultFeatureFlags.loginEnabled,
				downloadEnabled: defaultFeatureFlags.downloadEnabled,
				roadmapEnabled: defaultFeatureFlags.roadmapEnabled,
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
