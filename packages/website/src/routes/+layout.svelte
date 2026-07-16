<script lang="ts">
import { onMount } from "svelte";
import { get } from "svelte/store";
import { Tooltip } from "bits-ui";
import "./layout.css";
import { browser } from "$app/environment";
import JsonLd from "$lib/components/seo/json-ld.svelte";
import {
	isWebsiteThemePreference,
	setWebsiteThemePreference,
	THEME_STORAGE_KEY,
	websiteThemePreferenceStore,
} from "$lib/theme/theme.js";

let { children } = $props();

if (browser) {
	const preferenceAttr = document.documentElement.dataset.themePreference ?? null;
	const stored = (() => {
		try {
			return window.localStorage.getItem(THEME_STORAGE_KEY);
		} catch {
			return null;
		}
	})();
	const preference = isWebsiteThemePreference(preferenceAttr)
		? preferenceAttr
		: isWebsiteThemePreference(stored)
			? stored
			: "system";

	setWebsiteThemePreference(preference, { persist: false });
}

onMount(() => {
	if (!browser) return;

	const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
	const handleChange = () => {
		if (get(websiteThemePreferenceStore) === "system") {
			setWebsiteThemePreference("system", { persist: false });
		}
	};
	mediaQuery.addEventListener("change", handleChange);

	return () => {
		mediaQuery.removeEventListener("change", handleChange);
	};
});
</script>

<JsonLd />

<Tooltip.Provider delayDuration={0}>
	{@render children()}
</Tooltip.Provider>
