<script lang="ts">
	import type { Snippet } from "svelte";

	interface Props {
		/** Rendered inside the shared header card (tab bar area) */
		tabBar?: Snippet;
		/** Sidebar snippet — wrap in <aside class="w-[280px] ..."> yourself */
		sidebar?: Snippet;
		/** Main panels content */
		panels: Snippet;
		/** Extra CSS classes for the <main> element (desktop uses 'justify-center items-center' for empty state) */
		mainClass?: string;
	}

	let { tabBar, sidebar, panels, mainClass }: Props = $props();
</script>

<!--
	Shared app shell — used by both desktop main-app-view.svelte and website demo.
	Desktop wraps this in <ThemeProvider class="bg-primary p-1 overflow-hidden h-dvh">.
-->
<div class="flex flex-col h-full min-h-0 gap-0.5 bg-background rounded-xl p-0.5">
	<!-- Header card — tab bar + top bar -->
	{#if tabBar}
		<div
			class="flex flex-col gap-0.5 shrink-0 bg-card/50 border border-border rounded-lg overflow-hidden"
		>
			{@render tabBar()}
		</div>
	{/if}

	<!-- Content: sidebar + main panels -->
	<div class="flex-1 flex min-h-0 gap-0.5 overflow-hidden">
		{#if sidebar}
			{@render sidebar()}
		{/if}
		<main class="flex-1 flex h-full min-h-0 overflow-x-auto rounded-lg {mainClass ?? 'items-stretch'}">
			{@render panels()}
		</main>
	</div>
</div>
