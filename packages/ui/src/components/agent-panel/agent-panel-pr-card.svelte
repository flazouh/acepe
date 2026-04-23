<script lang="ts">
	import { GitPullRequest } from "phosphor-svelte";
	import { CaretDown } from "phosphor-svelte";

	import type { AgentPanelPrCardModel } from "./types.js";

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
	}

	let { visible, model, fetchError = null, initiallyExpanded = false }: Props = $props();

	const hasExpandedContent = $derived(
		Boolean(model.descriptionHtml) ||
			(model.commits?.length ?? 0) > 0 ||
			(model.checks?.length ?? 0) > 0 ||
			Boolean(model.isChecksLoading) ||
			Boolean(model.hasResolvedChecks) ||
			model.mode === "streaming"
	);
	const prState = $derived(
		model.state === "MERGED" ? "merged" : model.state === "CLOSED" ? "closed" : "open"
	);
</script>

<AgentPanelPrStatusCard {visible} {fetchError} {initiallyExpanded} {hasExpandedContent}>
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
				<GitPullRequest size={13} weight="bold" class="shrink-0" style="color: var(--success)" />
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
				size={14}
				weight="bold"
				class="shrink-0 text-muted-foreground transition-transform {isExpanded ? '' : 'rotate-180'}"
			/>
		{/if}
	{/snippet}

	{#snippet expandedContent()}
		{#if model.descriptionHtml}
			<div class="px-3 pt-2.5 pb-2 max-h-[200px] overflow-y-auto">
				<div class="markdown-content text-xs text-foreground leading-relaxed">
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
						<span class="text-[11px] text-foreground/70 truncate leading-none">{commit.message}</span>
					</div>
				{/each}
			</div>
		{/if}

		{#if model.mode === "pr" && ((model.checks?.length ?? 0) > 0 || model.isChecksLoading || model.hasResolvedChecks)}
			<div
				class:border-t={Boolean(model.descriptionHtml) || (model.commits?.length ?? 0) > 0}
				class="px-3 py-2 border-border/30"
			>
				<PrChecksList
					checks={model.checks ?? []}
					isLoading={model.isChecksLoading ?? false}
					hasResolved={model.hasResolvedChecks ?? false}
					collapseThreshold={model.checksCollapseThreshold ?? 3}
					onOpenCheck={model.onOpenCheck}
				/>
			</div>
		{/if}
	{/snippet}
</AgentPanelPrStatusCard>
