<script lang="ts">
	import AgentToolCard from "./agent-tool-card.svelte";
	import { buildCompactionContextUsageViewModel } from "./compaction-context-usage.js";
	import type { AgentSessionActivityEntry } from "./types.js";

	interface Props {
		entry: AgentSessionActivityEntry;
	}

	let { entry }: Props = $props();

	const statusLabel = $derived(
		entry.status === "preparing"
			? "Preparing"
			: entry.status === "usage_reset"
				? "Reset"
				: entry.status === "failed"
					? "Failed"
					: "Done"
	);
	const contextUsage = $derived(
		entry.contextUsage === null || entry.contextUsage === undefined
			? null
			: buildCompactionContextUsageViewModel(entry.contextUsage)
	);
	const contextComparisonLabel = $derived(
		contextUsage === null
			? ""
			: `Context ${contextUsage.afterTokens <= contextUsage.beforeTokens ? "reduced" : "changed"} from ${contextUsage.beforeTokens.toLocaleString("en-US")} to ${contextUsage.afterTokens.toLocaleString("en-US")} tokens`
	);
</script>

<AgentToolCard>
	<div
		class="px-2.5 py-2 text-sm text-muted-foreground"
		role="status"
		aria-label={entry.title}
		data-session-activity-kind={entry.activityKind}
		data-session-activity-status={entry.status}
	>
		<div class="flex items-center gap-2">
			<div class="font-medium text-foreground/80">{entry.title}</div>
			<div class="rounded border border-border/70 px-1.5 py-0.5 text-xs text-muted-foreground">
				{statusLabel}
			</div>
		</div>
		{#if entry.subtitle}
			<div class="mt-0.5">{entry.subtitle}</div>
		{/if}
		{#if contextUsage !== null}
			<div
				class="mt-2.5"
				role="img"
				aria-label={contextComparisonLabel}
				data-compaction-context-comparison
			>
				<div class="mb-1.5 grid grid-cols-2 gap-3 text-[11px] leading-none tabular-nums">
					<div class="flex min-w-0 items-center">
						<span class="mr-1 size-1.5 shrink-0 rounded-full bg-foreground/30"></span>
						<span class="text-muted-foreground/65">Before</span>
						<span class="ml-1 font-medium text-foreground/85">
							{contextUsage.beforeTokens.toLocaleString("en-US")}
						</span>
						{#if contextUsage.hasKnownWindow}
							<span class="ml-1 text-muted-foreground/55">{contextUsage.beforePercent}%</span>
						{/if}
					</div>
					<div class="flex min-w-0 items-center justify-end text-right">
						<span class="mr-1 size-1.5 shrink-0 rounded-full bg-success/70"></span>
						<span class="text-muted-foreground/65">After</span>
						<span class="ml-1 font-medium text-foreground/85">
							{contextUsage.afterTokens.toLocaleString("en-US")}
						</span>
						{#if contextUsage.hasKnownWindow}
							<span class="ml-1 text-muted-foreground/55">{contextUsage.afterPercent}%</span>
						{/if}
					</div>
				</div>
				<div class="relative h-2 overflow-hidden rounded-[3px] bg-foreground/[0.06] shadow-[inset_0_0_0_1px_rgb(255_255_255/0.04)]">
					<div
						class="absolute inset-y-0 left-0 bg-foreground/25"
						style:width={`${contextUsage.beforePercent}%`}
						data-compaction-context-segment="before"
					></div>
					<div
						class="absolute inset-y-0 left-0 bg-success/70"
						style:width={`${contextUsage.afterPercent}%`}
						data-compaction-context-segment="after"
					></div>
				</div>
			</div>
		{:else if entry.status === "preparing"}
			<div
				class="mt-2.5"
				role="progressbar"
				aria-label="Compaction in progress"
				aria-busy="true"
				data-compaction-context-preparing
			>
				<div class="h-1.5 overflow-hidden rounded-[3px] bg-foreground/[0.06]">
					<div class="compaction-indeterminate h-full w-1/3 rounded-[3px] bg-foreground/30"></div>
				</div>
			</div>
		{/if}
		{#if entry.metadata !== undefined && entry.metadata.length > 0}
			<div class="mt-2 flex flex-wrap gap-1.5">
				{#each entry.metadata as item (`${item.label}:${item.value}`)}
					<div class="rounded border border-border/60 px-1.5 py-0.5 text-xs">
						<span class="text-muted-foreground/70">{item.label}</span>
						<span class="ml-1 text-foreground/75">{item.value}</span>
					</div>
				{/each}
			</div>
		{/if}
	</div>
</AgentToolCard>

<style>
	.compaction-indeterminate {
		animation: compaction-slide 1.4s cubic-bezier(0.4, 0, 0.2, 1) infinite;
	}

	@keyframes compaction-slide {
		from {
			transform: translateX(-100%);
		}
		to {
			transform: translateX(300%);
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.compaction-indeterminate {
			animation: none;
		}
	}
</style>
