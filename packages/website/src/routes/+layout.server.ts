import { dev } from '$app/environment';
import type { LayoutServerLoad } from './$types';
import { getFeatureFlags } from '$lib/server/feature-flags';

export const load: LayoutServerLoad = async () => {
	const featureFlagsResult = await getFeatureFlags();

	// Use fallback values if feature flags fail to load
	const featureFlags = featureFlagsResult.isOk()
		? featureFlagsResult.value
		: {
				loginEnabled: false,
				downloadEnabled: false,
				roadmapEnabled: false
			};

	// In dev mode, always enable download
	if (dev) {
		featureFlags.downloadEnabled = true;
	}

	return {
		featureFlags
	};
};
