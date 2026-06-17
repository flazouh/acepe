<script lang="ts">
	import type { Snippet } from "svelte";
	import TextShimmer from "../text-shimmer/text-shimmer.svelte";
	import type { AgentToolStatus } from "./types.js";

	interface Props {
		/** Tool status for semantic color mapping */
		status?: AgentToolStatus;
		/** Disable shimmer while keeping status color */
		disableShimmer?: boolean;
		/** Label text size. Headers use `sm` to match assistant markdown; tool rows stay `xs`. */
		size?: "xs" | "sm";
		/** The label text to display */
		children: Snippet;
	}

	let { status = "done", disableShimmer = false, size = "xs", children }: Props = $props();

	const sizeClass = $derived(size === "sm" ? "text-sm" : "text-xs");

	const shouldShimmer = $derived(
		!disableShimmer && (status === "running" || status === "pending" || status === "blocked")
	);
</script>

{#if shouldShimmer}
	<TextShimmer class="shrink-0 {sizeClass}">
		{@render children()}
	</TextShimmer>
{:else}
	<span class="shrink-0 {sizeClass}">
		{@render children()}
	</span>
{/if}
