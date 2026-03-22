<script lang="ts">
	import Sparkle from "phosphor-svelte/lib/Sparkle";
	import type { Snippet } from "svelte";

	interface Props {
		appVersion?: string | null;
		whatsNewLabel?: string;
		onOpenChangelog?: () => void;
		queueSection?: Snippet;
		sessionList: Snippet;
		footer?: Snippet;
	}

	let {
		appVersion = null,
		whatsNewLabel = "What's New",
		onOpenChangelog,
		queueSection,
		sessionList,
		footer,
	}: Props = $props();
</script>

<aside class="w-[280px] shrink-0 flex flex-col h-full overflow-hidden gap-0">
	<!-- Queue Section -->
	{#if queueSection}
		{@render queueSection()}
	{/if}

	<!-- Projects/Sessions List -->
	<div class="flex-1 flex flex-col overflow-hidden">
		{@render sessionList()}
	</div>

	<!-- Footer -->
	{#if footer}
		{@render footer()}
	{:else if appVersion}
		<div class="px-3 py-2 flex items-center justify-between shrink-0">
			<span class="text-[10px] text-muted-foreground/50">v{appVersion}</span>
			{#if onOpenChangelog}
				<button
					onclick={onOpenChangelog}
					class="text-[10px] text-muted-foreground/50 hover:text-muted-foreground flex items-center gap-1 transition-colors"
					title={whatsNewLabel}
				>
					<Sparkle weight="fill" class="size-3" />
					{whatsNewLabel}
				</button>
			{/if}
		</div>
	{/if}
</aside>
