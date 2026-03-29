<!--
  PrStatusCard — Collapsible PR card above modified files.

  Matches modified-files-header visual style (bg-accent bar).
  Left: PR icon + #N — clicking opens PR in browser.
  Right: DiffPill + Merge button group (with strategy picker) + chevron.
  Click bar: expand/collapse with markdown description + commit list above.

  During AI generation the card auto-opens and streams the PR title and
  description live via the `streamingData` prop.

  Fully presentational — all data is passed in as props.
-->
<script lang="ts">
	import { DiffPill, GitHubBadge } from "@acepe/ui";
	import "@acepe/ui/markdown-prose.css";
	import * as DropdownMenu from "@acepe/ui/dropdown-menu";
	import { openUrl } from "@tauri-apps/plugin-opener";
	import { Result } from "neverthrow";
	import GitMerge from "phosphor-svelte/lib/GitMerge";
	import GitPullRequest from "phosphor-svelte/lib/GitPullRequest";
	import { Spinner } from "$lib/components/ui/spinner/index.js";
	import DiffViewerModal from "../diff-viewer/diff-viewer-modal.svelte";
	import * as m from "$lib/paraglide/messages.js";
	import { mergeStrategyStore } from "../../store/merge-strategy-store.svelte.js";
	import type { MergeStrategy } from "$lib/utils/tauri-client/git.js";
	import type { PrDetails } from "$lib/utils/tauri-client/git.js";
	import type { ShipCardData } from "../ship-card/ship-card-parser.js";
	import { renderMarkdownSync } from "../../utils/markdown-renderer.js";
	import AnimatedChevron from "../animated-chevron.svelte";
	import PrStateIcon from "../pr-state-icon.svelte";

	interface Props {
		projectPath: string;
		prNumber: number | null;
		isCreating: boolean;
		prDetails: PrDetails | null;
		fetchError: string | null;
		onMerge?: (strategy: MergeStrategy) => void;
		merging?: boolean;
		/** Live streaming data from AI generation — shown before the PR is created. */
		streamingData?: ShipCardData | null;
	}

	let {
		projectPath,
		prNumber,
		isCreating,
		prDetails,
		fetchError,
		onMerge,
		merging = false,
		streamingData = null,
	}: Props = $props();

	let isExpanded = $state(false);
	let diffModalOpen = $state(false);
	let selectedCommitSha = $state<string | null>(null);

	// Auto-expand when streaming data arrives
	const isStreaming = $derived(streamingData !== null && streamingData.started && !streamingData.complete);
	const hasStreamingContent = $derived(
		streamingData !== null && (streamingData.prTitle !== null || streamingData.prDescription !== null),
	);

	// Auto-expand when streaming begins; collapse is manual
	$effect(() => {
		if (hasStreamingContent && !isExpanded) {
			isExpanded = true;
		}
	});

	const safeRenderMarkdown = Result.fromThrowable(
		(body: string) => {
			const result = renderMarkdownSync(body);
			return result.html ? result.html : "";
		},
		() => "",
	);

	const descriptionHtml = $derived.by(() => {
		if (!prDetails?.body) return "";
		return safeRenderMarkdown(prDetails.body).unwrapOr("");
	});

	const streamingDescriptionHtml = $derived.by(() => {
		if (!streamingData?.prDescription) return "";
		return safeRenderMarkdown(streamingData.prDescription).unwrapOr("");
	});

	const hasExpandedContent = $derived(
		Boolean(descriptionHtml) || (prDetails?.commits?.length ? prDetails.commits.length > 0 : false) || hasStreamingContent,
	);

	// Show the card when streaming, creating, or a PR exists
	const isVisible = $derived(isCreating || prNumber !== null || hasStreamingContent);

	// Derive the title to display — streaming title takes priority during generation
	const displayTitle = $derived.by(() => {
		if (streamingData?.prTitle) return streamingData.prTitle;
		if (prDetails?.title) return prDetails.title;
		return null;
	});

	function handleOpenGitHub(e: MouseEvent) {
		e.stopPropagation();
		const url = prDetails?.url;
		if (url?.startsWith("https://github.com/")) {
			void openUrl(url).catch(() => {});
		}
	}

	function toggleExpand() {
		if (hasExpandedContent) isExpanded = !isExpanded;
	}

	function handleCommitClick(sha: string) {
		selectedCommitSha = sha;
		diffModalOpen = true;
	}
</script>

{#if isVisible}
	<div class="w-full px-5 mb-1">
		<!-- Expanded content: streaming preview OR description + commits -->
		{#if isExpanded && (hasStreamingContent || prDetails)}
			<div class="rounded-t-md bg-muted/30 overflow-hidden border border-b-0 border-border">
				<!-- Streaming preview (shown during AI generation) -->
				{#if hasStreamingContent && !prDetails}
					<div class="px-3 pt-2.5 pb-2 max-h-[300px] overflow-y-auto">
						{#if streamingDescriptionHtml}
							<div class="markdown-content text-xs text-foreground leading-relaxed">
								{@html streamingDescriptionHtml}
								{#if isStreaming}
									<span class="inline-block w-1.5 h-3 bg-foreground/50 animate-pulse ml-0.5 align-text-bottom"></span>
								{/if}
							</div>
						{:else if isStreaming}
							<div class="flex items-center gap-1.5 text-xs text-muted-foreground">
								<Spinner class="size-3" />
								<span>{m.pr_card_generating()}</span>
							</div>
						{/if}
					</div>
				{/if}

				<!-- Final PR content (shown after PR is created) -->
				{#if prDetails}
					{#if descriptionHtml}
						<div class="px-3 pt-2.5 pb-2 max-h-[200px] overflow-y-auto">
							<div class="markdown-content text-xs text-foreground leading-relaxed">
								{@html descriptionHtml}
							</div>
						</div>
					{/if}

					{#if prDetails.commits.length > 0}
						<div class="flex flex-col px-2 pb-1.5 {descriptionHtml ? 'border-t border-border/30 pt-1.5' : 'pt-1.5'}">
							{#each prDetails.commits as commit (commit.oid)}
								<div class="flex items-center gap-2 px-1 py-0.5">
									<GitHubBadge
										ref={{ type: "commit", sha: commit.oid }}
										insertions={commit.additions}
										deletions={commit.deletions}
										onclick={(e) => {
											e.stopPropagation();
											handleCommitClick(commit.oid);
										}}
									/>
									<span class="text-[11px] text-foreground/70 truncate leading-none">
										{commit.messageHeadline}
									</span>
								</div>
							{/each}
						</div>
					{/if}
				{/if}
			</div>
		{/if}

		<!-- Header bar -->
		<div
			role="button"
			tabindex="0"
			onclick={toggleExpand}
			onkeydown={(e) => e.key === "Enter" && toggleExpand()}
			class="w-full flex items-center justify-between px-3 py-1 rounded-md border border-border bg-muted/30 hover:bg-muted/40 transition-colors {hasExpandedContent
				? 'cursor-pointer'
				: 'cursor-default'} {isExpanded ? 'rounded-t-none border-t-0' : ''}"
		>
			<!-- Left: PR icon + number (clickable to open GitHub) OR streaming title OR spinner -->
			<div class="flex items-center gap-1.5 min-w-0 text-[0.6875rem]">
				{#if prDetails}
					<button
						type="button"
						class="flex items-center gap-1.5 shrink-0 hover:opacity-70 transition-opacity"
						onclick={handleOpenGitHub}
					>
						<PrStateIcon state={prDetails.state} size={13} />
						<span class="font-medium tabular-nums text-foreground">
							#{prDetails.number}
						</span>
					</button>
					<span class="text-foreground truncate leading-none ml-0.5">
						{prDetails.title}
					</span>
				{:else if hasStreamingContent}
					<GitPullRequest size={13} weight="bold" class="shrink-0" style="color: var(--success)" />
					{#if displayTitle}
						<span class="text-foreground truncate leading-none">
							{displayTitle}
							{#if isStreaming && streamingData?.activeField === "pr-title"}
								<span class="inline-block w-1 h-2.5 bg-foreground/50 animate-pulse ml-0.5 align-text-bottom"></span>
							{/if}
						</span>
					{:else}
						<span class="text-muted-foreground">{m.pr_card_generating()}</span>
					{/if}
				{:else if isCreating}
					<Spinner class="size-[13px]" />
					<span class="text-muted-foreground">{m.pr_card_creating()}</span>
				{:else if prNumber != null}
					<Spinner class="size-[13px]" />
					<span class="font-medium tabular-nums text-foreground">
						#{prNumber}
					</span>
				{/if}
			</div>

			<!-- Right: DiffPill + Merge button group + chevron -->
			{#if prDetails}
				<div class="flex items-center gap-2 shrink-0">
					<DiffPill
						insertions={prDetails.additions}
						deletions={prDetails.deletions}
						variant="plain"
					/>

					<!-- Merge button group -->
					{#if prDetails.state === "MERGED"}
						<div
							class="flex items-center gap-1 rounded border border-border/50 bg-muted px-2 py-0.5 text-[0.6875rem] font-medium text-muted-foreground opacity-60"
						>
							<PrStateIcon state="MERGED" size={11} />
							{m.pr_card_merged()}
						</div>
					{:else if onMerge}
						<DropdownMenu.Root>
							<div
								class="flex items-center rounded border border-border/50 bg-muted overflow-hidden"
								onclick={(e) => e.stopPropagation()}
								role="none"
							>
								<!-- Primary merge action (squash) -->
								<button
									type="button"
									disabled={merging}
									onclick={() => onMerge(mergeStrategyStore.strategy)}
									class="px-2 py-0.5 text-[0.6875rem] font-medium text-foreground/80 hover:text-foreground hover:bg-muted/80 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
								>
									{#if merging}
										<span class="flex items-center gap-1">
											<Spinner class="size-[11px]" />
											{m.pr_card_merge()}
										</span>
									{:else}
										<span class="flex items-center gap-1">
											<GitMerge size={11} weight="fill" />
											{m.pr_card_merge()}
										</span>
									{/if}
								</button>
								<!-- Strategy picker chevron -->
								<DropdownMenu.Trigger
									class="self-stretch flex items-center px-1 border-l border-border/50 text-muted-foreground hover:text-foreground hover:bg-muted/80 transition-colors disabled:opacity-50 outline-none"
									disabled={merging}
									onclick={(e) => e.stopPropagation()}
								>
									<svg class="size-2.5 text-muted-foreground" viewBox="0 0 10 10" fill="none">
										<path d="M2 3.5L5 6.5L8 3.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
									</svg>
								</DropdownMenu.Trigger>
							</div>
							<DropdownMenu.Content align="end" class="min-w-[150px]">
								<DropdownMenu.Item
									onSelect={() => { void mergeStrategyStore.set("squash"); onMerge("squash"); }}
									class="cursor-pointer text-[0.6875rem]"
								>
									{m.pr_card_squash_merge()}
								</DropdownMenu.Item>
								<DropdownMenu.Item
									onSelect={() => { void mergeStrategyStore.set("merge"); onMerge("merge"); }}
									class="cursor-pointer text-[0.6875rem]"
								>
									{m.pr_card_merge_commit()}
								</DropdownMenu.Item>
								<DropdownMenu.Item
									onSelect={() => { void mergeStrategyStore.set("rebase"); onMerge("rebase"); }}
									class="cursor-pointer text-[0.6875rem]"
								>
									{m.pr_card_rebase_merge()}
								</DropdownMenu.Item>
							</DropdownMenu.Content>
						</DropdownMenu.Root>
					{/if}

					{#if hasExpandedContent}
						<AnimatedChevron isOpen={isExpanded} class="size-3.5 text-muted-foreground" />
					{/if}
				</div>
			{/if}

			<!-- Streaming: show chevron when there's expandable streaming content -->
			{#if !prDetails && hasExpandedContent}
				<div class="flex items-center gap-2 shrink-0">
					{#if isStreaming}
						<Spinner class="size-3" />
					{/if}
					<AnimatedChevron isOpen={isExpanded} class="size-3.5 text-muted-foreground" />
				</div>
			{/if}
		</div>

		{#if fetchError}
			<div class="px-3 py-1.5 text-xs text-destructive/70 bg-muted/30 rounded-b-lg border border-t-0 border-border">{fetchError}</div>
		{/if}
	</div>
{/if}

{#if diffModalOpen && selectedCommitSha}
	<DiffViewerModal
		open={diffModalOpen}
		reference={{ type: "commit", sha: selectedCommitSha }}
		{projectPath}
		onClose={() => {
			diffModalOpen = false;
			selectedCommitSha = null;
		}}
	/>
{/if}
