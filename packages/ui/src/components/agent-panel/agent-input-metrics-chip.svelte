<!--
  AgentInputMetricsChip - Token usage / session spend chip with segmented context bar.

  Extracted from packages/desktop/src/lib/acp/components/model-selector.metrics-chip.svelte.
  Desktop derives these values from session store; here they are plain props.
-->
<script lang="ts">
	import { Colors } from "../../lib/colors.js";

	interface Props {
		/** Pre-formatted primary label (e.g., "2m/200k" or "$0.42"). */
		label?: string | null;
		/** Context usage 0-100. null hides the segmented bar. */
		percent?: number | null;
		compact?: boolean;
		hideLabel?: boolean;
		segmentCount?: number;
		ariaLabel?: string;
		title?: string;
	}

	let {
		label = null,
		percent = null,
		compact = false,
		hideLabel = false,
		segmentCount = 10,
		ariaLabel = "Context usage",
		title = "",
	}: Props = $props();

	const hasContextUsage = $derived(percent !== null);
	const effectiveSegmentCount = $derived(compact ? 8 : segmentCount);
	const segments = $derived.by(() => {
		const p = percent ?? 0;
		return Array.from({ length: effectiveSegmentCount }, (_, i) => {
			const threshold = ((i + 1) / effectiveSegmentCount) * 100;
			return p >= threshold;
		});
	});
</script>

<div
	class="flex items-center text-muted-foreground {compact
		? 'h-5 gap-1 px-0.5 text-[10px]'
		: 'h-7 gap-1.5 px-1.5 text-[11px]'}"
	role="status"
	aria-label={ariaLabel}
	{title}
>
	{#if !hideLabel && label}
		<span class="font-mono font-medium tabular-nums">{label}</span>
	{/if}
	{#if hasContextUsage}
		<div
			class="context-tally flex items-center gap-[2px]"
			class:context-tally-compact={compact}
			aria-hidden="true"
		>
			{#each segments as isFilled, index (index)}
				<span
					class="context-tally-bar"
					class:context-tally-bar-compact={compact}
					class:is-filled={isFilled}
					style={isFilled ? `background-color: ${Colors.purple};` : undefined}
				></span>
			{/each}
		</div>
	{/if}
</div>

<style>
	.context-tally { min-width: fit-content; }
	.context-tally-compact { gap: 1px; }
	.context-tally-bar {
		width: 3px;
		height: 10px;
		border-radius: 1px;
		background-color: color-mix(in srgb, var(--border) 55%, transparent);
		transition: background-color 160ms ease-out, opacity 160ms ease-out, transform 160ms ease-out;
		opacity: 0.55;
	}
	.context-tally-bar-compact { width: 2px; height: 8px; }
	.context-tally-bar.is-filled { opacity: 1; }
</style>
