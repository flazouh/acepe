<script lang="ts">
import { Tooltip } from "bits-ui";
import { page } from "$app/state";
import { locales, localizeHref } from "$lib/paraglide/runtime";
import "./layout.css";
import logo from "$lib/assets/favicon.svg";
import { browser } from "$app/environment";
import JsonLd from "$lib/components/seo/json-ld.svelte";
import Hreflang from "$lib/components/seo/hreflang.svelte";
import Canonical from "$lib/components/seo/canonical.svelte";
import { preInitializeMarkdown } from "$lib/markdown-renderer";
import { websiteThemeStore } from "$lib/theme/theme.js";
let { children } = $props();

// Initialize markdown renderer (only in browser — server has no origin for relative fetch)
if (browser) {
	preInitializeMarkdown();
}

if (browser) {
	// Sync theme from document (app.html sets it before our JS runs)
	const docTheme = document.documentElement.dataset.theme;
	if (docTheme === "light" || docTheme === "dark") {
		websiteThemeStore.set(docTheme);
	}
}
</script>

<svelte:head><link rel="icon" href={logo} /></svelte:head>

<JsonLd />
<Hreflang />
<Canonical />

<Tooltip.Provider delayDuration={0}>
	{@render children()}
</Tooltip.Provider>
<div style="display:none">
	{#each locales as locale}
		<a href={localizeHref(page.url.pathname, { locale })}>
			{locale}
		</a>
	{/each}
</div>
