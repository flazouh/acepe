<script lang="ts">
	import AgentToolDurationLabel from "./agent-tool-duration-label.svelte";
	import { getPlanningPlaceholderLabel } from "./planning-label.js";
	import TextShimmer from "../text-shimmer/text-shimmer.svelte";
	import type { ToolDurationTiming } from "./tool-duration.js";

	interface Props {
		timing?: ToolDurationTiming | null;
		label?: string | null;
		size?: "xs" | "sm";
		class?: string;
	}

	let {
		timing = null,
		label = null,
		size = "sm",
		class: className = "",
	}: Props = $props();

	const displayLabel = $derived(label ?? getPlanningPlaceholderLabel());
	const sizeClass = $derived(size === "sm" ? "text-sm" : "text-xs");
	const durationSizeClass = $derived(size === "sm" ? "text-xs" : "text-[10px]");
	const showDuration = $derived(timing !== null && timing !== undefined);
	const shimmerLabel = $derived(
		showDuration ? `${displayLabel} for` : displayLabel
	);
</script>

<div class="text-muted-foreground {className}">
	<span class="inline-flex min-w-0 items-baseline gap-1 {sizeClass}">
		<TextShimmer class="shrink-0 {sizeClass}">
			{shimmerLabel}
		</TextShimmer>
		{#if showDuration}
			<AgentToolDurationLabel
				{timing}
				numberClass="font-normal !normal-nums"
				class="shrink-0 text-muted-foreground/70 {durationSizeClass}"
			/>
		{/if}
	</span>
</div>
