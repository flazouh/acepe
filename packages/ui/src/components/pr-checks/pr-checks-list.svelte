<script lang="ts">
	import { MinusCircle, Wrench, XCircle } from "phosphor-svelte";
	import { untrack } from "svelte";

	import type { PrChecksItem } from "./types.js";
	import { bucketOfCheck, countCheckBuckets } from "./pr-checks-buckets.js";
	import {
		buildPrChecksSummarySegments,
		formatPrChecksSummaryAriaLabel,
	} from "./pr-checks-summary-format.js";
	import { Button } from "../button/index.js";
	import { LoadingIcon, RoundedIcon } from "../icons/index.js";

	interface Props {
		checks?: readonly PrChecksItem[];
		isLoading?: boolean;
		hasResolved?: boolean;
		initiallyExpanded?: boolean;
		/** Unused: kept for API compatibility. Successes are always rolled up. */
		collapseThreshold?: number;
		onOpenCheck?: (check: PrChecksItem, event: MouseEvent) => void;
		onFixCheck?: (check: PrChecksItem) => void;
		onViewDetails?: (check: PrChecksItem) => void;
	}

	let {
		checks = [],
		isLoading = false,
		hasResolved = false,
		initiallyExpanded = false,
		onOpenCheck,
		onFixCheck,
		onViewDetails,
	}: Props = $props();

	// Auto-expand when there are failures on first render.
	let showDetails = $state(
		untrack(() => initiallyExpanded || checks.some((c) => bucketOfCheck(c) === "failure"))
	);

	const bucketWeight: Record<ReturnType<typeof bucketOfCheck>, number> = {
		failure: 0,
		in_progress: 1,
		neutral: 2,
		success: 3,
	};

	const sortedChecks = $derived.by(() => {
		const indexed = checks.map((check, index) => ({ check, index }));
		indexed.sort((a, b) => {
			const wa = bucketWeight[bucketOfCheck(a.check)];
			const wb = bucketWeight[bucketOfCheck(b.check)];
			if (wa !== wb) return wa - wb;
			return a.index - b.index;
		});
		return indexed.map((entry) => entry.check);
	});

	const counts = $derived(countCheckBuckets(checks));
	const summarySegments = $derived(buildPrChecksSummarySegments(counts));
	const summaryAriaLabel = $derived(formatPrChecksSummaryAriaLabel(counts, checks.length));

	const isWaitingForCi = $derived(hasResolved && checks.length === 0);

	function formatDuration(startedAt: string | null, completedAt: string | null): string | null {
		if (!startedAt) return null;
		const start = Date.parse(startedAt);
		if (Number.isNaN(start)) return null;
		const end = completedAt ? Date.parse(completedAt) : Date.now();
		if (Number.isNaN(end) || end < start) return null;
		const ms = end - start;
		if (ms < 1000) return `${ms}ms`;
		const totalSeconds = Math.round(ms / 1000);
		if (totalSeconds < 60) return `${totalSeconds}s`;
		const minutes = Math.floor(totalSeconds / 60);
		const seconds = totalSeconds % 60;
		if (minutes < 60) return seconds === 0 ? `${minutes}m` : `${minutes}m ${seconds}s`;
		const hours = Math.floor(minutes / 60);
		const remMinutes = minutes % 60;
		return remMinutes === 0 ? `${hours}h` : `${hours}h ${remMinutes}m`;
	}
</script>

{#if isLoading || isWaitingForCi || checks.length > 0}
	<div class="flex flex-col gap-0.5">
		{#if isWaitingForCi}
			<div class="flex items-center gap-1.5 text-[10.5px] text-muted-foreground leading-none">
				<LoadingIcon class="animate-spin shrink-0" size={12} />
				<span>Waiting for CI…</span>
			</div>
		{:else if isLoading && checks.length === 0}
			<div class="flex items-center gap-1.5 text-[10.5px] text-muted-foreground leading-none">
				<LoadingIcon class="animate-spin shrink-0" size={12} />
				<span>Checking CI…</span>
			</div>
		{:else if checks.length > 0}
			<!-- Detail rows -->
			{#if showDetails}
				<div class="flex flex-col mb-0.5">
					{#each sortedChecks as check (`${check.name}:${check.workflowName ?? ""}:${check.startedAt ?? ""}:${check.detailsUrl ?? ""}`)}
						{@const bucket = bucketOfCheck(check)}
						{@const durationLabel = formatDuration(check.startedAt, check.completedAt)}
						<div class="flex items-center gap-1.5 py-[2px] min-w-0">
							<span class="shrink-0">
								{#if bucket === "in_progress"}
									<LoadingIcon class="animate-spin text-muted-foreground" size={10} />
								{:else if bucket === "failure"}
									<XCircle size={10} weight="fill" class="text-destructive" />
								{:else if bucket === "neutral"}
									<MinusCircle size={10} weight="fill" class="text-amber-400" />
								{:else}
									<RoundedIcon name="check-circle" class="size-2.5 text-emerald-500" />
								{/if}
							</span>
							{#if onViewDetails}
								<button
									type="button"
									class="text-sm text-foreground/80 truncate flex-1 min-w-0 text-left hover:underline"
									title={check.name}
									onclick={(event) => {
										event.stopPropagation();
										onViewDetails(check);
									}}
								>
									{check.name}
								</button>
							{:else}
								<span
									class="text-sm text-foreground/80 truncate flex-1 min-w-0"
									title={check.name}
								>
									{check.name}
								</span>
							{/if}
							{#if durationLabel}
								<span class="text-xs text-muted-foreground/55 tabular-nums shrink-0"
									>{durationLabel}</span
								>
							{/if}
							<span class="inline-flex items-center gap-0.5 shrink-0">
								{#if bucket === "failure" && onFixCheck}
									<Button
										variant="ghost"
										size="icon-2xs"
										class="rounded-sm"
										aria-label="Ask agent to fix {check.name}"
										title="Fix with agent"
										onclick={(event) => {
											event.stopPropagation();
											onFixCheck(check);
										}}
									>
										<Wrench size={10} weight="fill" />
									</Button>
								{/if}
								{#if check.detailsUrl}
									<Button
										variant="ghost"
										size="icon-2xs"
										class="rounded-sm"
										aria-label="Open {check.name} on GitHub"
										title="View on GitHub"
										onclick={(event) => {
											event.stopPropagation();
											onOpenCheck?.(check, event);
										}}
									>
										<RoundedIcon name="github" class="size-2.5" />
									</Button>
								{/if}
							</span>
						</div>
					{/each}
				</div>
			{/if}

			<!-- Summary row — click anywhere to toggle -->
			<button
				type="button"
				class="flex w-full items-center gap-1.5 text-[10.5px] leading-none tabular-nums hover:opacity-75 transition-opacity"
				aria-expanded={showDetails}
				aria-label={summaryAriaLabel}
				onclick={(event) => {
					event.stopPropagation();
					showDetails = !showDetails;
				}}
			>
				<div class="flex items-center gap-2 min-w-0 flex-1">
					{#each summarySegments as segment, index (segment.kind)}
						{#if index > 0}
							<span class="text-muted-foreground/45" aria-hidden="true">·</span>
						{/if}
						<span
							class="inline-flex items-center gap-1 font-medium {segment.kind === 'failure'
								? 'text-destructive'
								: segment.kind === 'in_progress'
									? 'text-muted-foreground'
									: segment.kind === 'neutral'
										? 'text-amber-400'
										: 'text-emerald-500'}"
						>
							{#if segment.kind === "failure"}
								<XCircle size={11} weight="fill" />
							{:else if segment.kind === "in_progress"}
								<LoadingIcon class="animate-spin" size={11} />
							{:else if segment.kind === "neutral"}
								<MinusCircle size={11} weight="fill" />
							{:else}
								<RoundedIcon name="check-circle" class="size-[11px]" />
							{/if}
							{segment.label}
						</span>
					{/each}
				</div>
				<RoundedIcon name="chevron-down" class="size-3 shrink-0 text-muted-foreground/50 transition-transform {showDetails ? 'rotate-180' : ''}"
				/>
			</button>
		{/if}
	</div>
{/if}
