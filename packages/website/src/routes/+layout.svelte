<script lang="ts">
import { Tooltip } from "bits-ui";
import "./layout.css";
import { browser } from "$app/environment";
import JsonLd from "$lib/components/seo/json-ld.svelte";
import { websiteThemeStore } from "$lib/theme/theme.js";
let { children } = $props();

if (browser) {
	// Sync theme from document (app.html sets it before our JS runs)
	const docTheme = document.documentElement.dataset.theme;
	if (docTheme === "light" || docTheme === "dark") {
		websiteThemeStore.set(docTheme);
	}
}
</script>

<JsonLd />

<Tooltip.Provider delayDuration={0}>
	{@render children()}
</Tooltip.Provider>
