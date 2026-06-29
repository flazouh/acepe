<script lang="ts">
	import { CaretDown, CheckCircle, GithubLogo, MinusCircle, Wrench, XCircle } from "phosphor-svelte";
	import { untrack } from "svelte";

	import type { PrChecksItem, PrChecksItemConclusion } from "./types.js";
	import { Button } from "../button/index.js";
	import { LoadingIcon } from "../icons/index.js";

	interface Props {
		checks?: readonly PrChecksItem[];
		isLoading?: boolean;
		hasResolved?: boolean;
		initiallyExpanded?: boolean;
		/** Unused: kept for API compatibility. Successes are always rolled up. */
		collapseThreshold?: number;
		onOpenCheck?: (check: PrChecksItem, event: MouseEvent) => void;
		onFixCheck?: (check: PrChecksItem) => void;
	}

	let {
		checks = [],
		isLoading = false,
		hasResolved = false,
		initiallyExpanded = false,
		onOpenCheck,
		onFixCheck,
	}: Props = $props();

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

	// Auto-expand when there are failures on first render.
	let showDetails = $state(
		untrack(() => initiallyExpanded || checks.some((c) => bucketOf(c) === "failure"))
	);

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
						{@const bucket = bucketOf(check)}
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
									<CheckCircle size={10} weight="fill" class="text-emerald-500" />
								{/if}
							</span>
							<span
								class="text-sm text-foreground/80 truncate flex-1 min-w-0"
								title={check.name}
							>
								{check.name}
							</span>
							{#if durationLabel}
								<span class="text-xs text-muted-foreground/55 tabular-nums shrink-0"
									>{durationLabel}</span
								>
							{/if}
							<span class="inline-flex items-center gap-0.5 shrink-0">
								{#if bucket === "failure" && onFixCheck}
									<Button
										variant="chromeIcon"
										size="chromeIcon"
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
										variant="chromeIcon"
										size="chromeIcon"
										class="rounded-sm"
										aria-label="Open {check.name} on GitHub"
										title="View on GitHub"
										onclick={(event) => {
											event.stopPropagation();
											onOpenCheck?.(check, event);
										}}
									>
										<GithubLogo size={10} weight="fill" />
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
				onclick={(event) => {
					event.stopPropagation();
					showDetails = !showDetails;
				}}
			>
				<div class="flex items-center gap-2 min-w-0 flex-1">
					{#if counts.failure > 0}
						<span class="inline-flex items-center gap-1 text-destructive font-medium">
							<XCircle size={11} weight="fill" />
							{counts.failure}
						</span>
					{/if}
					{#if counts.inProgress > 0}
						<span class="inline-flex items-center gap-1 text-muted-foreground">
							<LoadingIcon class="animate-spin" size={11} />
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
					<span class="text-muted-foreground/55">
						· {checks.length}
						{checks.length === 1 ? "check" : "checks"}
					</span>
				</div>
				<CaretDown
					size={9}
					weight="bold"
					class="shrink-0 text-muted-foreground/50 transition-transform {showDetails
						? 'rotate-180'
						: ''}"
				/>
			</button>
		{/if}
	</div>
{/if}
