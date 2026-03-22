<!--
  PrStatusCard — Collapsible PR card above modified files.

  Matches modified-files-header visual style (bg-accent bar).
  Left: PR icon + #N — clicking opens PR in browser.
  Right: DiffPill + Merge button group (with strategy picker) + chevron.
  Click bar: expand/collapse with markdown description + commit list above.

  Fully presentational — all data is passed in as props.
-->
<script lang="ts">
	import { DiffPill, GitHubBadge } from "@acepe/ui";
	import "@acepe/ui/markdown-prose.css";
	import * as DropdownMenu from "@acepe/ui/dropdown-menu";
	import { openUrl } from "@tauri-apps/plugin-opener";
	import { Result } from "neverthrow";
	import GitMerge from "phosphor-svelte/lib/GitMerge";
	import SpinnerGap from "phosphor-svelte/lib/SpinnerGap";
	import DiffViewerModal from "../diff-viewer/diff-viewer-modal.svelte";
	import * as m from "$lib/paraglide/messages.js";
	import { mergeStrategyStore } from "../../store/merge-strategy-store.svelte.js";
	import type { MergeStrategy } from "$lib/utils/tauri-client/git.js";
	import type { PrDetails } from "$lib/utils/tauri-client/git.js";
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
	}

	let {
		projectPath,
		prNumber,
		isCreating,
		prDetails,
		fetchError,
		onMerge,
		merging = false,
	}: Props = $props();

	let isExpanded = $state(false);
	let diffModalOpen = $state(false);
	let selectedCommitSha = $state<string | null>(null);

	const safeRenderMarkdown = Result.fromThrowable(
		(body: string) => {
			const result = renderMarkdownSync(body);
			return result.html ?? "";
		},
		() => "",
	);

	const descriptionHtml = $derived.by(() => {
		if (!prDetails?.body) return "";
		return safeRenderMarkdown(prDetails.body).unwrapOr("");
	});

	const hasExpandedContent = $derived(
		Boolean(descriptionHtml) || (prDetails?.commits?.length ?? 0) > 0,
	);

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

{#if isCreating || prNumber}
	<div class="w-full px-5 mb-1">
		<!-- Expanded content: description + commits -->
		{#if isExpanded && prDetails}
			<div class="rounded-t-md bg-muted/30 overflow-hidden border border-b-0 border-border">
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
			<!-- Left: PR icon + number (clickable to open GitHub) OR spinner while creating -->
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
				{:else if isCreating}
					<SpinnerGap size={13} class="shrink-0 animate-spin text-muted-foreground" />
					<span class="text-muted-foreground">{m.pr_card_creating()}</span>
				{:else if prNumber != null}
					<SpinnerGap size={13} class="shrink-0 animate-spin text-muted-foreground" />
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
											<SpinnerGap size={11} class="animate-spin" />
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
