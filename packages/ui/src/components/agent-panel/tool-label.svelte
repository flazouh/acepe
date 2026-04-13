<script lang="ts">
	import type { Snippet } from "svelte";

	import { TextShimmer } from "../text-shimmer/index.js";
	import type { AgentToolStatus } from "./types.js";

	interface Props {
		/** Tool status — shimmer is applied when pending or running */
		status?: AgentToolStatus;
		/** The label text to display */
		children: Snippet;
	}

	let { status = "done", children }: Props = $props();

	const isPending = $derived(status === "pending" || status === "running");
</script>

<span class="inline-block min-w-0 max-w-full truncate text-xs font-normal tracking-normal text-muted-foreground">
	{#if isPending}
		<TextShimmer class="block truncate">
			{@render children()}
		</TextShimmer>
	{:else}
		{@render children()}
	{/if}
</span>
