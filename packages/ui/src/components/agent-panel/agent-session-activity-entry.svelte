<!--
  AgentSessionActivityEntry - Session-level activity (compaction) rendered as a
  quiet seam in the transcript: a hairline rule carrying a small centered
  cluster. Everything above the seam was condensed, so the divider IS the
  message. Before/after context pressure reuses the composer fuel-gauge idiom
  at miniature scale; preparing shimmers indeterminately (never a percentage).
-->
<script lang="ts">
	import RoundedIcon from "../icons/rounded-icon.svelte";
	import TextShimmer from "../text-shimmer/text-shimmer.svelte";
	import {
		formatCompactTokens,
		gaugeFillHeightPx,
		resolveComparableUsage,
		resolveSessionActivityGauge,
		sessionActivityAriaLabel,
		sessionActivityDetailParts,
	} from "./agent-session-activity-entry-state.js";
	import type {
		AgentSessionActivityContextUsage,
		AgentSessionActivityEntry,
		AgentSessionActivityMetadataItem,
	} from "./types.js";

	interface Props {
		title: string;
		status: AgentSessionActivityEntry["status"];
		subtitle?: string | null;
		contextUsage?: AgentSessionActivityContextUsage | null;
		metadata?: readonly AgentSessionActivityMetadataItem[];
	}

	let { title, status, subtitle = null, contextUsage = null, metadata = undefined }: Props = $props();

	// Gauge geometry: 14px track with a 1px inset on each edge -> 10px usable fill.
	const GAUGE_TRACK_PX = 14;
	const GAUGE_INNER_PX = GAUGE_TRACK_PX - 4;

	const isPreparing = $derived(status === "preparing");
	const comparableUsage = $derived(isPreparing ? null : resolveComparableUsage(contextUsage));
	const gauge = $derived(isPreparing ? null : resolveSessionActivityGauge(contextUsage));
	const detailParts = $derived(
		isPreparing ? [] : sessionActivityDetailParts(subtitle, metadata)
	);
	const ariaLabel = $derived(
		sessionActivityAriaLabel({ title, status, subtitle: isPreparing ? null : subtitle, contextUsage, metadata })
	);
</script>

{#snippet gaugeTrack(percent: number, fillClass: string)}
	<span
		class="relative w-[5px] overflow-hidden rounded-[2px] border border-foreground/25 p-px"
		style:height={`${GAUGE_TRACK_PX}px`}
	>
		<span
			class="absolute bottom-px left-px right-px rounded-[1px] {fillClass}"
			style:height={`${gaugeFillHeightPx(percent, GAUGE_INNER_PX)}px`}
		></span>
	</span>
{/snippet}

<div
	class="agent-session-activity-entry flex min-w-0 flex-col gap-1 py-1.5"
	role="status"
	aria-busy={isPreparing ? "true" : undefined}
	aria-label={ariaLabel}
	data-status={status}
	data-testid="agent-session-activity-entry"
>
	<div class="flex min-w-0 items-center gap-3">
		<span class="h-px min-w-3 flex-1 bg-border/60" aria-hidden="true"></span>
		<span class="flex min-w-0 shrink items-center gap-2 text-xs text-muted-foreground">
			{#if isPreparing}
				<TextShimmer class="truncate text-xs">{title}</TextShimmer>
			{:else}
				{#if status === "failed"}
					<RoundedIcon name="warning" class="size-3.5 shrink-0 text-destructive" />
				{:else if status === "usage_reset"}
					<RoundedIcon name="refresh" class="size-3.5 shrink-0 text-muted-foreground/70" />
				{:else if gauge !== null}
					<span
						class="flex shrink-0 items-end gap-[3px]"
						aria-hidden="true"
						data-testid="compaction-gauge"
					>
						{@render gaugeTrack(gauge.beforePercent, gauge.beforeFillClass)}
						{@render gaugeTrack(gauge.afterPercent, gauge.afterFillClass)}
					</span>
				{/if}
				<span class="truncate font-medium text-foreground/75" {title}>{title}</span>
				{#if comparableUsage !== null}
					<span class="shrink-0 font-mono text-[11px] leading-none text-muted-foreground">
						<span>{formatCompactTokens(comparableUsage.before)}</span>
						<span class="text-muted-foreground/50">→</span>
						<span class="text-foreground/70">{formatCompactTokens(comparableUsage.after)}</span>
					</span>
				{/if}
			{/if}
		</span>
		<span class="h-px min-w-3 flex-1 bg-border/60" aria-hidden="true"></span>
	</div>
	{#if detailParts.length > 0}
		<div class="px-6 text-center text-[11px] leading-4 text-muted-foreground/70">
			{#each detailParts as part, index}
				{#if index > 0}<span class="text-muted-foreground/40">{" · "}</span>{/if}
				<span class="whitespace-nowrap">{part}</span>
			{/each}
		</div>
	{/if}
</div>
