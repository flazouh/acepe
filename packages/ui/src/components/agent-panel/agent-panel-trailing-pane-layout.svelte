<!--
  Hosts optional trailing pane columns; host app renders each region via snippets.
-->
<script lang="ts">
	import type { Snippet } from "svelte";

	let {
		showPlan,
		showBrowser,
		showTerminal,
		plan,
		browser,
		terminal,
	}: {
		showPlan: boolean;
		showBrowser: boolean;
		showTerminal?: boolean;
		plan: Snippet;
		browser: Snippet;
		terminal?: Snippet;
	} = $props();
</script>

{#if showPlan}
	{@render plan()}
{/if}
{#if showBrowser}
	{@render browser()}
{/if}
{#if showTerminal && terminal}
	{@render terminal()}
{/if}
