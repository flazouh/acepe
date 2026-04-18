<!--
  Hosts optional plan sidebar and browser column; host app renders each region via snippets.
-->
<script lang="ts">
	import type { Snippet } from "svelte";

	let {
		showPlan,
		showBrowser,
		plan,
		browser,
	}: {
		showPlan: boolean;
		showBrowser: boolean;
		plan: Snippet;
		browser: Snippet;
	} = $props();
</script>

{#if showPlan}
	{@render plan()}
{/if}
{#if showBrowser}
	{@render browser()}
{/if}
