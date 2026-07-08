<script lang="ts">
	import AgentToolDurationLabel from "./agent-tool-duration-label.svelte";
	import ClaudeWorkingSpark from "./claude-working-spark.svelte";
	import { getPlanningPlaceholderLabel } from "./planning-label.js";
	import TextShimmer from "../text-shimmer/text-shimmer.svelte";
	import type { ToolDurationTiming } from "./tool-duration.js";

	interface Props {
		timing?: ToolDurationTiming | null;
		label?: string | null;
		agentIconSrc?: string | null;
		size?: "xs" | "sm";
		/** When true, the Claude working spark replaces the planning label (the timer stays). */
		showWorkingSpark?: boolean;
		class?: string;
	}

	let {
		timing = null,
		label = null,
		agentIconSrc = null,
		size = "sm",
		showWorkingSpark = false,
		class: className = "",
	}: Props = $props();

	const displayLabel = $derived(label ?? getPlanningPlaceholderLabel());
	const sizeClass = $derived(size === "sm" ? "text-sm" : "text-xs");
	const durationSizeClass = $derived(size === "sm" ? "text-xs" : "text-[10px]");
	const showDuration = $derived(timing !== null && timing !== undefined);
	const sparkSize = $derived(size === "sm" ? 16 : 14);
	const shimmerLabel = $derived(
		showDuration ? `${displayLabel} for` : displayLabel
	);
</script>

<div class="text-muted-foreground {className}">
	{#if showWorkingSpark}
		<span class="inline-flex min-w-0 items-center gap-1.5 {sizeClass}">
			<ClaudeWorkingSpark size={sparkSize} label={displayLabel} />
			{#if showDuration}
				<AgentToolDurationLabel
					{timing}
					numberClass="font-normal !normal-nums"
					class="shrink-0 text-muted-foreground/70 {durationSizeClass}"
				/>
			{/if}
		</span>
	{:else}
		<span class="inline-flex min-w-0 items-center gap-1.5 {sizeClass}">
			{#if agentIconSrc !== null}
				<img
					src={agentIconSrc}
					alt=""
					role="presentation"
					class="size-4 shrink-0 rounded-[4px]"
				/>
			{/if}
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
	{/if}
</div>
