<script lang="ts">
	import { ArrowSquareOut, GitPullRequest } from "phosphor-svelte";

	import { DiffPill } from "../diff-pill/index.js";

	let {
		prNumber,
		state,
		title,
		url,
		additions,
		deletions,
		isLoading,
		hasResolvedDetails,
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
		onOpen: () => void;
		onOpenExternal: () => void;
	} = $props();

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
				{#if hasResolvedDetails && additions != null && deletions != null}
					<DiffPill insertions={additions} deletions={deletions} variant="plain" class="text-[10px]" />
				{:else}
					<div class="h-3 w-20 rounded bg-muted" aria-hidden="true"></div>
				{/if}
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
