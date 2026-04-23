<script lang="ts">
	import { ArrowSquareOut, GitPullRequest } from "phosphor-svelte";

	import { DiffPill } from "../diff-pill/index.js";
	import { PrChecksList, PrChecksSummary, type PrChecksItem } from "../pr-checks/index.js";

	let {
		prNumber,
		state,
		title,
		url,
		additions,
		deletions,
		isLoading,
		hasResolvedDetails,
		checks,
		isChecksLoading,
		hasResolvedChecks,
		onOpenCheck,
		onOpen,
		onOpenExternal,
	}: {
		prNumber: number;
		state: "OPEN" | "CLOSED" | "MERGED";
		title: string | null;
		url: string | null;
		additions: number | null;
		deletions: number | null;
		isLoading: boolean;
		hasResolvedDetails: boolean;
		checks: readonly PrChecksItem[];
		isChecksLoading: boolean;
		hasResolvedChecks: boolean;
		onOpenCheck?: (check: PrChecksItem, event: MouseEvent) => void;
		onOpen: () => void;
		onOpenExternal: () => void;
	} = $props();

	let checksExpanded = $state(false);

	function handleKeydown(event: KeyboardEvent): void {
		if (event.key !== "Enter" && event.key !== " ") {
			return;
		}

		event.preventDefault();
		onOpen();
	}
</script>

<div
	class="flex items-stretch gap-2 px-2 py-2 hover:bg-accent/40 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-border/80"
	role="button"
	tabindex={0}
	aria-label={`Open PR #${prNumber} in Source Control`}
	onclick={onOpen}
	onkeydown={handleKeydown}
>
	<div class="flex min-w-0 flex-1 items-start gap-2">
		<div class="mt-0.5 shrink-0 text-muted-foreground">
			<GitPullRequest size={13} weight="bold" />
		</div>
		<div class="min-w-0 flex-1">
			<div class="flex items-center gap-1 text-[10px] text-muted-foreground">
				<span>PR #{prNumber}</span>
				<span>·</span>
				<span>{state}</span>
				{#if isLoading}
					<span>·</span>
					<span>Refreshing…</span>
				{/if}
			</div>
			{#if title}
				<div class="truncate text-xs font-medium text-foreground">{title}</div>
			{:else}
				<div class="mt-1 h-3 w-40 rounded bg-muted" aria-hidden="true"></div>
			{/if}
			<div class="mt-1">
				<div class="flex items-center gap-2">
					{#if hasResolvedDetails && additions != null && deletions != null}
						<DiffPill insertions={additions} deletions={deletions} variant="plain" class="text-[10px]" />
					{:else}
						<div class="h-3 w-20 rounded bg-muted" aria-hidden="true"></div>
					{/if}
					<button
						type="button"
						class="inline-flex h-5 items-center gap-1 rounded px-1.5 text-[10px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
						aria-label={checksExpanded ? "Hide CI checks" : "Show CI checks"}
						title={checksExpanded ? "Hide CI checks" : "Show CI checks"}
						onclick={(event) => {
							event.stopPropagation();
							checksExpanded = !checksExpanded;
						}}
					>
						<PrChecksSummary checks={checks} isLoading={isChecksLoading} hasResolved={hasResolvedChecks} />
						<span>CI</span>
					</button>
				</div>
			</div>
		</div>
	</div>

	<button
		type="button"
		class="mt-0.5 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50"
		aria-label={`Open PR #${prNumber} on GitHub`}
		title={`Open PR #${prNumber} on GitHub`}
		disabled={url == null}
		onclick={(event) => {
			event.stopPropagation();
			onOpenExternal();
		}}
	>
		<ArrowSquareOut size={12} weight="bold" />
	</button>
</div>

{#if checksExpanded}
	<div class="border-t border-border/30 px-2 pb-2 pt-1.5">
		<PrChecksList
			{checks}
			isLoading={isChecksLoading}
			hasResolved={hasResolvedChecks}
			collapseThreshold={3}
			{onOpenCheck}
		/>
	</div>
{/if}
