<script lang="ts">
	import { ArrowSquareOut, CheckCircle, MinusCircle, XCircle } from "phosphor-svelte";

	import type { PrChecksItem } from "./types.js";
	import { LoadingIcon } from "../icons/index.js";

	interface Props {
		checks?: readonly PrChecksItem[];
		isLoading?: boolean;
		hasResolved?: boolean;
		collapseThreshold?: number;
		onOpenCheck?: (check: PrChecksItem, event: MouseEvent) => void;
	}

	let {
		checks = [],
		isLoading = false,
		hasResolved = false,
		collapseThreshold = 3,
		onOpenCheck,
	}: Props = $props();

	let expanded = $state(false);

	const isWaitingForCi = $derived(hasResolved && checks.length === 0);
	const shouldCollapse = $derived(checks.length > collapseThreshold);
	const visibleChecks = $derived(
		shouldCollapse && !expanded ? checks.slice(0, collapseThreshold) : checks
	);
	const hiddenCount = $derived(Math.max(checks.length - collapseThreshold, 0));

	function isNeutralConclusion(conclusion: PrChecksItem["conclusion"]): boolean {
		return (
			conclusion === "NEUTRAL" ||
			conclusion === "CANCELLED" ||
			conclusion === "SKIPPED" ||
			conclusion === "STALE" ||
			conclusion === "UNKNOWN"
		);
	}

	function isFailureConclusion(conclusion: PrChecksItem["conclusion"]): boolean {
		return (
			conclusion === "FAILURE" ||
			conclusion === "TIMED_OUT" ||
			conclusion === "ACTION_REQUIRED" ||
			conclusion === "STARTUP_FAILURE"
		);
	}
</script>

{#if isLoading || isWaitingForCi || checks.length > 0}
	<div class="flex flex-col gap-1.5">
		{#if isWaitingForCi}
			<div class="flex items-center gap-2 text-[11px] text-muted-foreground">
				<LoadingIcon class="size-3 animate-spin shrink-0" />
				<span>Waiting for CI…</span>
			</div>
		{:else if isLoading && checks.length === 0}
			<div class="flex items-center gap-2 text-[11px] text-muted-foreground">
				<LoadingIcon class="size-3 animate-spin shrink-0" />
				<span>Checking CI…</span>
			</div>
		{/if}

		{#each visibleChecks as check (`${check.name}:${check.workflowName ?? ""}:${check.startedAt ?? ""}:${check.detailsUrl ?? ""}`)}
			<div class="flex min-w-0 items-center gap-2 text-[11px] text-foreground/80">
				<div class="shrink-0 text-muted-foreground">
					{#if check.status !== "COMPLETED"}
						<LoadingIcon class="size-3 animate-spin" />
					{:else if isFailureConclusion(check.conclusion)}
						<XCircle size={12} weight="fill" class="text-red-500" />
					{:else if isNeutralConclusion(check.conclusion)}
						<MinusCircle size={12} weight="fill" class="text-amber-400" />
					{:else}
						<CheckCircle size={12} weight="fill" class="text-emerald-500" />
					{/if}
				</div>
				<span class="min-w-0 flex-1 truncate">{check.name}</span>
				{#if check.detailsUrl}
					<button
						type="button"
						class="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
						aria-label={`Open ${check.name} on GitHub`}
						title={`Open ${check.name} on GitHub`}
						onclick={(event) => {
							event.stopPropagation();
							onOpenCheck?.(check, event);
						}}
					>
						<ArrowSquareOut size={11} weight="bold" />
					</button>
				{/if}
			</div>
		{/each}

		{#if shouldCollapse}
			<button
				type="button"
				class="self-start text-[11px] text-muted-foreground transition-colors hover:text-foreground"
				onclick={(event) => {
					event.stopPropagation();
					expanded = !expanded;
				}}
			>
				{#if expanded}
					Show less
				{:else}
					+{hiddenCount} more
				{/if}
			</button>
		{/if}
	</div>
{/if}
