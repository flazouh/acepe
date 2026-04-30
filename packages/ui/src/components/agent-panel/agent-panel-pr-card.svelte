<script lang="ts">
	import { GitPullRequest, GitMerge } from "phosphor-svelte";
	import { CaretDown } from "phosphor-svelte";

	import type { AgentPanelPrCardModel } from "./types.js";

	import { Colors } from "../../lib/colors.js";
	import { DiffPill } from "../diff-pill/index.js";
	import { GitHubBadge } from "../github-badge/index.js";
	import { LoadingIcon } from "../icons/index.js";
	import { PrChecksList } from "../pr-checks/index.js";
	import AgentPanelPrStatusCard from "./pr-status-card.svelte";

	interface Props {
		visible: boolean;
		model: AgentPanelPrCardModel;
		fetchError?: string | null;
		initiallyExpanded?: boolean;
		initiallyExpandedChecks?: boolean;
	}

	let {
		visible,
		model,
		fetchError = null,
		initiallyExpanded = false,
		initiallyExpandedChecks = false,
	}: Props = $props();

	const hasChecks = $derived(
		(model.checks?.length ?? 0) > 0 ||
			Boolean(model.isChecksLoading) ||
			Boolean(model.hasResolvedChecks)
	);
	const hasExpandedContent = $derived(
		Boolean(model.descriptionHtml) ||
			(model.commits?.length ?? 0) > 0 ||
			model.mode === "streaming"
	);
	const prState = $derived(
		model.state === "MERGED" ? "merged" : model.state === "CLOSED" ? "closed" : "open"
	);
	const headerIconColor = $derived(
		prState === "merged"
			? Colors.purple
			: prState === "closed"
				? "var(--destructive)"
				: "var(--success)"
	);
</script>

<AgentPanelPrStatusCard {visible} {fetchError} {initiallyExpanded} {hasExpandedContent} hasBelowHeader={hasChecks}>
	{#snippet headerMain()}
		{#if model.mode === "pr" && model.number !== null && model.number !== undefined}
			<button
				type="button"
				class="flex items-center gap-1.5 shrink-0 hover:opacity-70 transition-opacity"
				onclick={(event) => {
					event.stopPropagation();
					model.onOpen?.(event);
				}}
			>
				{#if prState === "merged"}
					<GitMerge size={13} weight="bold" class="shrink-0" style="color: {headerIconColor}" />
				{:else}
					<GitPullRequest size={13} weight="bold" class="shrink-0" style="color: {headerIconColor}" />
				{/if}
				<span class="font-medium tabular-nums text-foreground">#{model.number}</span>
			</button>
			{#if model.title}
				<span class="text-foreground truncate leading-none ml-0.5">{model.title}</span>
			{/if}
		{:else if model.mode === "streaming"}
			<GitPullRequest size={13} weight="bold" class="shrink-0" style="color: var(--success)" />
			{#if model.title}
				<span class="text-foreground truncate leading-none">
					{model.title}
					{#if model.isStreaming}
						<span class="inline-block w-1 h-2.5 bg-foreground/50 animate-pulse ml-0.5 align-text-bottom"></span>
					{/if}
				</span>
			{:else}
				<span class="text-muted-foreground">{model.generatingLabel ?? "Generating PR…"}</span>
			{/if}
		{:else if model.mode === "creating"}
			<LoadingIcon class="size-[13px] shrink-0 animate-spin" />
			<span class="text-muted-foreground">{model.creatingLabel ?? "Creating PR…"}</span>
		{:else if model.number !== null && model.number !== undefined}
			<LoadingIcon class="size-[13px] shrink-0 animate-spin" />
			<span class="font-medium tabular-nums text-foreground">#{model.number}</span>
		{/if}
	{/snippet}

	{#snippet headerActions(isExpanded: boolean)}
		{#if model.mode === "pr"}
			<DiffPill insertions={model.additions ?? 0} deletions={model.deletions ?? 0} variant="plain" />
		{/if}
		{#if hasExpandedContent}
			{#if model.mode === "streaming" && model.isStreaming}
				<LoadingIcon class="size-3 shrink-0 animate-spin" />
			{/if}
			<CaretDown
				size={12}
				weight="bold"
				class="shrink-0 text-muted-foreground/80 transition-transform {isExpanded ? '' : 'rotate-180'}"
			/>
		{/if}
	{/snippet}

	{#snippet belowHeader()}
		{#if model.mode === "pr" && hasChecks}
			<div class="px-3 py-1.5 bg-input/30 rounded-b-md border-x border-b border-border">
				<PrChecksList
					checks={model.checks ?? []}
					isLoading={model.isChecksLoading ?? false}
					hasResolved={model.hasResolvedChecks ?? false}
					initiallyExpanded={initiallyExpandedChecks}
					collapseThreshold={model.checksCollapseThreshold ?? 3}
					onOpenCheck={model.onOpenCheck}
				/>
			</div>
		{/if}
	{/snippet}

	{#snippet expandedContent()}
		{#if model.descriptionHtml}
			<div class="px-3 pt-0 pb-2 max-h-[200px] overflow-y-auto">
				<div class="markdown-content text-sm text-foreground leading-relaxed">
					{@html model.descriptionHtml}
					{#if model.mode === "streaming" && model.isStreaming}
						<span class="inline-block w-1.5 h-3 bg-foreground/50 animate-pulse ml-0.5 align-text-bottom"></span>
					{/if}
				</div>
			</div>
		{/if}

		{#if model.commits && model.commits.length > 0}
			<div class="flex flex-col px-2 pb-1.5 {model.descriptionHtml ? 'border-t border-border/30 pt-1.5' : 'pt-1.5'}">
				{#each model.commits as commit (commit.sha)}
					<div class="flex items-center gap-2 px-1 py-0.5">
						<GitHubBadge
							ref={{ type: "commit", sha: commit.sha }}
							insertions={commit.insertions ?? 0}
							deletions={commit.deletions ?? 0}
							onclick={(event) => {
								event.stopPropagation();
								commit.onClick?.(event);
							}}
						/>
						<span class="text-sm text-foreground/70 truncate leading-none">{commit.message}</span>
					</div>
				{/each}
			</div>
		{/if}
	{/snippet}
</AgentPanelPrStatusCard>
