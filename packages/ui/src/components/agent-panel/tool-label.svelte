<script lang="ts">
	import type { Snippet } from "svelte";

	import { TextShimmer } from "../text-shimmer/index.js";
	import type { AgentToolStatus } from "./types.js";

	interface Props {
		/** Tool status for semantic color mapping */
		status?: AgentToolStatus;
		/** Disable shimmer while keeping status color */
		disableShimmer?: boolean;
		/** The label text to display */
		children: Snippet;
	}

let { status = "done", disableShimmer = false, children }: Props = $props();
	const isLoading = $derived(status === "pending" || status === "running");
	const statusClass = $derived.by(() => {
		if (status === "blocked") return "text-amber-600 dark:text-amber-400";
		if (status === "degraded") return "text-orange-600 dark:text-orange-400";
		if (status === "cancelled") return "text-muted-foreground/70";
		if (status === "error") return "text-destructive";
		return "text-muted-foreground";
	});
</script>

<span class="shrink-0 text-sm tracking-normal {statusClass}">
	{#if isLoading && !disableShimmer}
		<TextShimmer>{@render children()}</TextShimmer>
	{:else}
		{@render children()}
	{/if}
</span>
