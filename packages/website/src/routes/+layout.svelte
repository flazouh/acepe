<script lang="ts">
import { Tooltip } from "bits-ui";
import "./layout.css";
import logo from "$lib/assets/favicon.svg";
import { browser } from "$app/environment";
import JsonLd from "$lib/components/seo/json-ld.svelte";
import Canonical from "$lib/components/seo/canonical.svelte";
import { preInitializeMarkdown } from "$lib/markdown-renderer";
let { children } = $props();

// Initialize markdown renderer (only in browser — server has no origin for relative fetch)
if (browser) {
	preInitializeMarkdown();
}
</script>

<svelte:head><link rel="icon" href={logo} /></svelte:head>

<JsonLd />
<Canonical />

<Tooltip.Provider delayDuration={0}>
	{@render children()}
</Tooltip.Provider>
