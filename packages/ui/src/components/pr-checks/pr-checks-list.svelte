<script lang="ts">
	import { CaretDown, CheckCircle, GithubLogo, MinusCircle, XCircle } from "phosphor-svelte";
	import { untrack } from "svelte";

	import type { PrChecksItem, PrChecksItemConclusion } from "./types.js";
	import { Button } from "../button/index.js";
	import { LoadingIcon } from "../icons/index.js";
	import { Tooltip, TooltipContent, TooltipTrigger } from "../tooltip/index.js";

	interface Props {
		checks?: readonly PrChecksItem[];
		isLoading?: boolean;
		hasResolved?: boolean;
		initiallyExpanded?: boolean;
		/** Unused: kept for API compatibility. Successes are always rolled up. */
		collapseThreshold?: number;
		onOpenCheck?: (check: PrChecksItem, event: MouseEvent) => void;
	}

	let {
		checks = [],
		isLoading = false,
		hasResolved = false,
		initiallyExpanded = false,
		onOpenCheck,
	}: Props = $props();

	let showDetails = $state(untrack(() => initiallyExpanded));

	function isNeutralConclusion(conclusion: PrChecksItemConclusion | null): boolean {
		return (
			conclusion === "NEUTRAL" ||
			conclusion === "CANCELLED" ||
			conclusion === "SKIPPED" ||
			conclusion === "STALE" ||
			conclusion === "UNKNOWN"
		);
	}

	function isFailureConclusion(conclusion: PrChecksItemConclusion | null): boolean {
		return (
			conclusion === "FAILURE" ||
			conclusion === "TIMED_OUT" ||
			conclusion === "ACTION_REQUIRED" ||
			conclusion === "STARTUP_FAILURE"
		);
	}

	type CheckBucket = "failure" | "in_progress" | "neutral" | "success";

	function bucketOf(check: PrChecksItem): CheckBucket {
		if (check.status !== "COMPLETED") return "in_progress";
		if (isFailureConclusion(check.conclusion)) return "failure";
		if (isNeutralConclusion(check.conclusion)) return "neutral";
		return "success";
	}

	const bucketWeight: Record<CheckBucket, number> = {
		failure: 0,
		in_progress: 1,
		neutral: 2,
		success: 3,
	};

	const sortedChecks = $derived.by(() => {
		const indexed = checks.map((check, index) => ({ check, index }));
		indexed.sort((a, b) => {
			const wa = bucketWeight[bucketOf(a.check)];
			const wb = bucketWeight[bucketOf(b.check)];
			if (wa !== wb) return wa - wb;
			return a.index - b.index;
		});
		return indexed.map((entry) => entry.check);
	});

	const counts = $derived.by(() => {
		let failure = 0;
		let inProgress = 0;
		let neutral = 0;
		let success = 0;
		for (const check of checks) {
			switch (bucketOf(check)) {
				case "failure":
					failure += 1;
					break;
				case "in_progress":
					inProgress += 1;
					break;
				case "neutral":
					neutral += 1;
					break;
				case "success":
					success += 1;
					break;
			}
		}
		return { failure, inProgress, neutral, success };
	});

	const detailChecks = $derived(sortedChecks);

	const isWaitingForCi = $derived(hasResolved && checks.length === 0);
	const overallTone = $derived.by(() => {
		if (counts.failure > 0) return "destructive";
		if (counts.inProgress > 0) return "muted";
		if (counts.neutral > 0) return "amber";
		if (counts.success > 0) return "success";
		return "muted";
	});

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

	function durationMs(startedAt: string | null, completedAt: string | null): number | null {
		if (!startedAt) return null;
		const start = Date.parse(startedAt);
		if (Number.isNaN(start)) return null;
		const end = completedAt ? Date.parse(completedAt) : Date.now();
		if (Number.isNaN(end) || end < start) return null;
		return end - start;
	}

	function timingBarCount(ms: number | null): number {
		if (ms === null) return 0;
		const tenSecondChunkMs = 10_000;
		const rawBars = Math.ceil(ms / tenSecondChunkMs);
		const cappedBars = Math.min(12, rawBars);
		return Math.max(1, cappedBars);
	}
</script>

{#if isLoading || isWaitingForCi || checks.length > 0}
	<div class="flex flex-col gap-1">
		{#if isWaitingForCi}
			<div class="flex items-center gap-1.5 text-[10.5px] text-muted-foreground leading-none">
				<LoadingIcon class="size-3 animate-spin shrink-0" />
				<span>Waiting for CI…</span>
			</div>
		{:else if isLoading && checks.length === 0}
			<div class="flex items-center gap-1.5 text-[10.5px] text-muted-foreground leading-none">
				<LoadingIcon class="size-3 animate-spin shrink-0" />
				<span>Checking CI…</span>
			</div>
		{:else if checks.length > 0}
			{#if showDetails}
				<div class="markdown-content">
					<div class="table-wrapper !my-1">
						<table>
							<tbody>
								{#each detailChecks as check (`${check.name}:${check.workflowName ?? ""}:${check.startedAt ?? ""}:${check.detailsUrl ?? ""}`)}
									{@const bucket = bucketOf(check)}
									{@const elapsedMs = durationMs(check.startedAt, check.completedAt)}
									{@const durationLabel = formatDuration(check.startedAt, check.completedAt)}
									{@const barCount = timingBarCount(elapsedMs)}
									{@const timingToneClass = bucket === "failure" ? "bg-destructive" : "bg-emerald-500"}
									<tr>
										<td>
											<span class="inline-flex items-center gap-1.5 min-w-0">
												{#if bucket === "in_progress"}
													<LoadingIcon class="size-3 animate-spin text-muted-foreground" />
												{:else if bucket === "failure"}
													<XCircle size={11} weight="fill" class="text-destructive" />
												{:else if bucket === "neutral"}
													<MinusCircle size={11} weight="fill" class="text-amber-400" />
												{:else}
													<CheckCircle size={11} weight="fill" class="text-emerald-500" />
												{/if}
												<span class="truncate" title={check.name}>{check.name}</span>
											</span>
										</td>
										<td class="tabular-nums">
											{#if barCount > 0 && durationLabel}
												<Tooltip>
													<TooltipTrigger>
														{#snippet child({ props })}
															<div
																{...props}
																class="inline-flex items-center gap-0.5"
																aria-label={`Duration ${durationLabel}`}
															>
																{#each Array.from({ length: barCount }) as _, barIndex (barIndex)}
																	<span
																		class="inline-block h-2 w-[2px] rounded-full {timingToneClass}"
																	></span>
																{/each}
															</div>
														{/snippet}
													</TooltipTrigger>
													<TooltipContent>{durationLabel}</TooltipContent>
												</Tooltip>
											{:else}
												<span class="text-muted-foreground/60">—</span>
											{/if}
										</td>
										<td>
											{#if check.detailsUrl}
												<Button
													variant="ghost"
													size="headerAction"
													class="h-5 w-5 p-0 rounded-sm text-muted-foreground hover:!bg-foreground/12 hover:text-foreground dark:hover:!bg-foreground/20"
													aria-label={`Open ${check.name} on GitHub`}
													title={`Open ${check.name} on GitHub`}
													onclick={(event) => {
														event.stopPropagation();
														onOpenCheck?.(check, event);
													}}
												>
													<GithubLogo size={11} weight="fill" />
												</Button>
											{:else}
												<span class="text-muted-foreground/60">—</span>
											{/if}
										</td>
									</tr>
								{/each}
							</tbody>
						</table>
					</div>
				</div>
			{/if}

			<div class="flex w-full items-center justify-between text-[10.5px] leading-none tabular-nums">
				<div class="flex items-center gap-2 min-w-0">
				{#if counts.failure > 0}
					<span class="inline-flex items-center gap-1 text-destructive font-medium">
						<XCircle size={11} weight="fill" />
						{counts.failure}
					</span>
				{/if}
				{#if counts.inProgress > 0}
					<span class="inline-flex items-center gap-1 text-muted-foreground">
						<LoadingIcon class="size-3 animate-spin" />
						{counts.inProgress}
					</span>
				{/if}
				{#if counts.neutral > 0}
					<span class="inline-flex items-center gap-1 text-amber-400">
						<MinusCircle size={11} weight="fill" />
						{counts.neutral}
					</span>
				{/if}
				{#if counts.success > 0}
					<span class="inline-flex items-center gap-1 text-emerald-500">
						<CheckCircle size={11} weight="fill" />
						{counts.success}
					</span>
				{/if}
				<span
					class="text-muted-foreground/70 {overallTone === 'destructive'
						? 'text-destructive/80'
						: ''}"
				>
					· {checks.length} {checks.length === 1 ? "check" : "checks"}
				</span>
				</div>
				<button
					type="button"
					class="group inline-flex items-center gap-1 rounded px-1.5 py-1 text-muted-foreground/70 transition-colors hover:bg-accent/40 hover:text-foreground"
					aria-expanded={showDetails}
					title={showDetails ? "Hide CI details" : "Show CI details"}
					onclick={(event) => {
						event.stopPropagation();
						showDetails = !showDetails;
					}}
				>
					<span>{showDetails ? "Hide details" : "View details"}</span>
					<CaretDown
						size={10}
						weight="bold"
						class="transition-transform {showDetails ? 'rotate-180' : ''}"
					/>
				</button>
			</div>
		{/if}
	</div>
{/if}
