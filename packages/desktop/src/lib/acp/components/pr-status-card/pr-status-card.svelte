<!--
  PrStatusCard — Collapsible PR card above modified files.

  Matches modified-files-header visual style (bg-accent bar).
  Left: PR icon + #N — clicking opens PR in browser.
  Right: DiffPill + chevron.
  Click bar: expand/collapse with markdown description + commit list above.

  During AI generation the card auto-opens and streams the PR title and
  description live via the `streamingData` prop.

  The merge button lives in ModifiedFilesHeader, not here.

  Fully presentational — all data is passed in as props.
-->
<script lang="ts">
	import { DiffPill, GitHubBadge } from "@acepe/ui";
	import "@acepe/ui/markdown-prose.css";
	import { openUrl } from "@tauri-apps/plugin-opener";
	import { Result } from "neverthrow";
	import GitPullRequest from "phosphor-svelte/lib/GitPullRequest";
	import { Spinner } from "$lib/components/ui/spinner/index.js";
	import DiffViewerModal from "../diff-viewer/diff-viewer-modal.svelte";
	import * as m from "$lib/paraglide/messages.js";
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
		/** Live streaming data from AI generation — shown before the PR is created. */
		streamingData?: ShipCardData | null;
	}

	let {
		projectPath,
		prNumber,
		isCreating,
		prDetails,
		fetchError,
		streamingData = null,
	}: Props = $props();

	let isExpanded = $state(
		(() => {
			if (!streamingData) return false;
			return streamingData.prTitle !== null || streamingData.prDescription !== null;
		})(),
	);
	let diffModalOpen = $state(false);
	let selectedCommitSha = $state<string | null>(null);

	// Auto-expand when streaming data arrives
	const isStreaming = $derived(streamingData !== null && streamingData.started && !streamingData.complete);
	const hasStreamingContent = $derived(
		streamingData !== null && (streamingData.prTitle !== null || streamingData.prDescription !== null),
	);

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

	// Show the card when streaming content arrives or a PR exists (not during initial creating phase)
	const isVisible = $derived(prNumber !== null || hasStreamingContent);

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
	<div class="w-full px-5">
		<!-- Header bar -->
		<div
			role="button"
			tabindex="0"
			onclick={toggleExpand}
			onkeydown={(e) => e.key === "Enter" && toggleExpand()}
			class="w-full flex items-center justify-between px-3 py-1 rounded-md border border-border bg-muted/30 hover:bg-muted/40 transition-colors {hasExpandedContent
				? 'cursor-pointer'
				: 'cursor-default'} {isExpanded ? 'rounded-b-none border-b-0' : ''}"
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

			<!-- Right: DiffPill + chevron -->
			{#if prDetails}
				<div class="flex items-center gap-2 shrink-0">
					<DiffPill
						insertions={prDetails.additions}
						deletions={prDetails.deletions}
						variant="plain"
					/>

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

		<!-- Expanded content: streaming preview OR description + commits -->
		{#if isExpanded && (hasStreamingContent || prDetails)}
			<div class="rounded-b-md bg-muted/30 overflow-hidden border border-t-0 border-border">
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
