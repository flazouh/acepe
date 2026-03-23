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

<span class="shrink-0 text-xs font-normal tracking-normal text-muted-foreground">
	{#if isPending}
		<TextShimmer>
			{@render children()}
		</TextShimmer>
	{:else}
		{@render children()}
	{/if}
</span>
