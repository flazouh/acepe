<!--
	git-workspace.svelte — Source Control panel body (presentational).

	Renders INSIDE a flat dialog that already owns the surface, the project picker, and the
	close button. So this component draws NO outer card / border / shadow — it is transparent
	and fills its host. Hairline dividers, tight spacing, muted→foreground hierarchy.

	────────────────────────────────────────────────────────────────────────────────────────
	INFORMATION ARCHITECTURE
	────────────────────────────────────────────────────────────────────────────────────────
	Top: a quiet UNDERLINE tab bar for the four sections — Changes · Commits · Pull Requests ·
	Worktrees — each with an optional count rendered as a soft `bg-accent/40` pill. This is the
	primary navigation (no multicolor pill icons; no icons at all — uniform text tabs).

	CHANGES section (the primary surface) has its own sub-header:
	  • Branch control — borderless `bg-accent/30` chip (a fused-control look) that opens the
	    branch switcher via onBranchClick. A caret hints it is a trigger.
	  • Ahead/behind — quiet inline `↑n ↓n` text (informational only). No refresh/push/pull
	    icon buttons anywhere (explicitly unwanted).
	  • A segmented-style sub-nav: Status · History · Stash.

	The CHANGES body is a two-pane split: a left LIST pane (file lists / commit log / stash)
	and a right DIFF pane that renders the host-owned `selectedDiff` snippet. When nothing is
	selected the diff pane shows a quiet empty hint. The commit composer is pinned to the
	bottom of the LIST pane and only appears in the Status sub-view.

	Commits / Pull Requests / Worktrees: this component owns only the section chrome (the tab
	bar + a scroll container). The BODIES are host-owned snippets (`commitsContent`,
	`prsContent`, `worktreesContent`).

	────────────────────────────────────────────────────────────────────────────────────────
	PROP-NAME REFINEMENTS vs the supplied interface
	────────────────────────────────────────────────────────────────────────────────────────
	None. Every prop in the brief is implemented with the same name and meaning. The only
	additions are presentational sub-components (git-status-row.svelte) kept in this folder.

	SNIPPET SLOTS THE HOST MUST FILL
	  • selectedDiff      — diff for the selected file/commit (shown in the right pane of
	                        Changes when selectedFile / a log entry is selected).
	  • commitMic         — mic affordance rendered in the commit composer toolbar (optional).
	  • commitsContent    — body of the Commits section.
	  • prsContent        — body of the Pull Requests section.
	  • worktreesContent  — body of the Worktrees section.
-->
<script lang="ts">
	import type { Snippet } from "svelte";
	import {
		GitBranch,
		GitCommit,
		GitPullRequest,
		ListChecks,
		Sparkle,
		Tree,
	} from "phosphor-svelte";

	import { Button } from "../button/index.js";
	import { ButtonGroup } from "../button-group/index.js";
	import { RoundedIcon } from "../icons/index.js";
	import SegmentedToggleGroup from "../panel-header/segmented-toggle-group.svelte";
	import { cn } from "../../lib/utils.js";
	import GitStatusRow from "./git-status-row.svelte";
	import type { GitLogEntry, GitRemoteStatus, GitStashEntry, GitStatusFile } from "./types.js";

	type GitSection = "changes" | "commits" | "prs" | "worktrees";
	type ChangesView = "status" | "history" | "stash";

	interface Props {
		branch: string;
		remoteStatus: GitRemoteStatus | null;
		onBranchClick?: () => void;

		activeSection: GitSection;
		onSectionChange: (section: GitSection) => void;
		commitsCount?: number;
		prCount?: number;
		worktreeCount?: number;

		// Changes view
		activeView: ChangesView;
		onViewChange: (view: ChangesView) => void;
		stagedFiles: GitStatusFile[];
		unstagedFiles: GitStatusFile[];
		selectedFile: string;
		onFileSelect: (path: string) => void;
		onStage: (path: string) => void;
		onUnstage: (path: string) => void;
		onStageAll: () => void;
		onDiscard: (path: string) => void;

		logEntries: GitLogEntry[];
		onLogSelect?: (sha: string) => void;

		stashEntries: GitStashEntry[];
		onStashPop?: (index: number) => void;
		onStashDrop?: (index: number) => void;

		// Commit composer
		commitMessage: string;
		onCommitMessageChange: (message: string) => void;
		onCommit: () => void;
		canCommit: boolean;
		canCommitPush: boolean;
		canCommitPushPr: boolean;
		onCommitPush: () => void;
		onCommitPushPr: () => void;
		onGenerate?: () => void;
		generating: boolean;

		// Snippet slots (host-owned heavy content)
		selectedDiff?: Snippet;
		commitMic?: Snippet;
		commitsContent?: Snippet;
		prsContent?: Snippet;
		worktreesContent?: Snippet;

		class?: string;
	}

	let {
		branch,
		remoteStatus,
		onBranchClick,
		activeSection,
		onSectionChange,
		commitsCount,
		prCount,
		worktreeCount,
		activeView,
		onViewChange,
		stagedFiles,
		unstagedFiles,
		selectedFile,
		onFileSelect,
		onStage,
		onUnstage,
		onStageAll,
		onDiscard,
		logEntries,
		onLogSelect,
		stashEntries,
		onStashPop,
		onStashDrop,
		commitMessage,
		onCommitMessageChange,
		onCommit,
		canCommit,
		canCommitPush,
		canCommitPushPr,
		onCommitPush,
		onCommitPushPr,
		onGenerate,
		generating,
		selectedDiff,
		commitMic,
		commitsContent,
		prsContent,
		worktreesContent,
		class: className = "",
	}: Props = $props();

	const sections = $derived<
		readonly { id: GitSection; label: string; icon: typeof GitCommit; count?: number }[]
	>([
		{
			id: "changes",
			label: "Changes",
			icon: ListChecks,
			count: stagedFiles.length + unstagedFiles.length,
		},
		{ id: "commits", label: "Commits", icon: GitCommit, count: commitsCount },
		{ id: "prs", label: "Pull Requests", icon: GitPullRequest, count: prCount },
		{ id: "worktrees", label: "Worktrees", icon: Tree, count: worktreeCount },
	]);

	const views: readonly { id: ChangesView; label: string }[] = [
		{ id: "status", label: "Status" },
		{ id: "history", label: "History" },
		{ id: "stash", label: "Stash" },
	];

	const hasSelection = $derived(selectedFile.length > 0);
	const stagedAvailable = $derived(unstagedFiles.length > 0);

	function handleComposerInput(event: Event): void {
		const target = event.currentTarget as HTMLTextAreaElement;
		onCommitMessageChange(target.value);
	}
</script>

<div class={cn("flex h-full min-h-0 flex-col bg-background text-foreground", className)}>
	<!-- Section navigation: segmented control with an icon per tab -->
	<div class="flex shrink-0 items-center border-b border-border/50 px-3 py-2">
		<SegmentedToggleGroup
			items={sections.map((section) => ({ id: section.id, label: section.label }))}
			value={activeSection}
			onChange={(id) => onSectionChange(id as GitSection)}
			itemClass="!text-xs gap-1.5 px-2.5 py-1"
		>
			{#snippet itemContent(item)}
				{@const section = sections.find((candidate) => candidate.id === item.id)}
				{#if section}
					<section.icon size={14} weight="bold" class="shrink-0" />
				{/if}
				<span>{item.label}</span>
				{#if section?.count != null && section.count > 0}
					<span class="text-[0.625rem] leading-none tabular-nums opacity-70">{section.count}</span>
				{/if}
			{/snippet}
		</SegmentedToggleGroup>
	</div>

	{#if activeSection === "changes"}
		<!-- Changes sub-header: branch control + ahead/behind + sub-nav -->
		<div class="flex shrink-0 items-center gap-3 border-b border-border/30 px-3 py-2">
			<ButtonGroup class="overflow-hidden rounded-md bg-accent/30">
				<button
					type="button"
					data-slot="button"
					onclick={() => onBranchClick?.()}
					disabled={!onBranchClick}
					title="Switch branch"
					class="flex min-w-0 items-center gap-1.5 !bg-transparent px-2 py-1 text-sm leading-none text-foreground transition-colors hover:bg-accent/60 disabled:pointer-events-none"
				>
					<GitBranch size={14} class="shrink-0 text-muted-foreground" />
					<span class="truncate font-normal">{branch}</span>
					{#if onBranchClick}
						<RoundedIcon name="chevron-down" class="size-3 shrink-0 text-muted-foreground/70" />
					{/if}
				</button>

				{#if remoteStatus && (remoteStatus.ahead > 0 || remoteStatus.behind > 0)}
					<div
						class="flex shrink-0 items-center gap-3 border-l border-border/40 px-2.5 text-sm tabular-nums text-muted-foreground"
						title="{remoteStatus.ahead} ahead, {remoteStatus.behind} behind {remoteStatus.trackingBranch}"
					>
						{#if remoteStatus.ahead > 0}
							<span class="flex items-center gap-0.5">
								<RoundedIcon name="arrow-up" class="size-3" />{remoteStatus.ahead}
							</span>
						{/if}
						{#if remoteStatus.behind > 0}
							<span class="flex items-center gap-0.5">
								<RoundedIcon name="arrow-up" class="size-3 rotate-180" />{remoteStatus.behind}
							</span>
						{/if}
					</div>
				{/if}
			</ButtonGroup>

			<div class="ml-auto flex shrink-0 items-center gap-3">
				{#each views as view (view.id)}
					{@const active = activeView === view.id}
					<button
						type="button"
						onclick={() => onViewChange(view.id)}
						aria-pressed={active}
						class={cn(
							"text-xs transition-colors",
							active
								? "font-medium text-foreground"
								: "text-muted-foreground/60 hover:text-foreground"
						)}
					>
						{view.label}
					</button>
				{/each}
			</div>
		</div>

		<!-- Two-pane body: list (left) + diff (right) -->
		<div class="flex min-h-0 flex-1">
			<div class="flex min-h-0 w-[44%] min-w-[260px] max-w-[460px] flex-col border-r border-border/30">
				<div class="min-h-0 flex-1 overflow-y-auto px-2 py-2">
					{#if activeView === "status"}
						{#if stagedFiles.length === 0 && unstagedFiles.length === 0}
							<p class="px-2 py-6 text-center text-xs text-muted-foreground/60">
								No changes in the working tree.
							</p>
						{:else}
							{#if unstagedFiles.length > 0}
								<div class="mb-1 flex items-center justify-between px-2">
									<span
										class="text-[0.6875rem] font-medium uppercase tracking-wide text-muted-foreground/60"
									>
										Changes
									</span>
									<Button
										variant="ghost"
										size="xs"
										onclick={onStageAll}
										disabled={!stagedAvailable}
										title="Stage all changes"
									>
										{#snippet children()}Stage all{/snippet}
									</Button>
								</div>
								<div class="mb-3 flex flex-col gap-px">
									{#each unstagedFiles as file (file.path)}
										<GitStatusRow
											{file}
											kind="unstaged"
											selected={selectedFile === file.path}
											onSelect={onFileSelect}
											onPrimary={onStage}
											{onDiscard}
										/>
									{/each}
								</div>
							{/if}

							{#if stagedFiles.length > 0}
								<div class="mb-1 px-2">
									<span
										class="text-[0.6875rem] font-medium uppercase tracking-wide text-muted-foreground/60"
									>
										Staged
									</span>
								</div>
								<div class="flex flex-col gap-px">
									{#each stagedFiles as file (file.path)}
										<GitStatusRow
											{file}
											kind="staged"
											selected={selectedFile === file.path}
											onSelect={onFileSelect}
											onPrimary={onUnstage}
											{onDiscard}
										/>
									{/each}
								</div>
							{/if}
						{/if}
					{:else if activeView === "history"}
						{#if logEntries.length === 0}
							<p class="px-2 py-6 text-center text-xs text-muted-foreground/60">No commits yet.</p>
						{:else}
							<div class="flex flex-col gap-px">
								{#each logEntries as entry (entry.sha)}
									{@const selected = selectedFile === entry.sha}
									<button
										type="button"
										onclick={() => {
											onFileSelect(entry.sha);
											onLogSelect?.(entry.sha);
										}}
										class={cn(
											"flex flex-col items-stretch gap-0.5 rounded-md px-2 py-1.5 text-left transition-colors",
											selected ? "bg-accent/60" : "hover:bg-accent/30"
										)}
									>
										<span class="truncate text-sm text-foreground/90">{entry.message}</span>
										<span
											class="flex items-center gap-2 text-xs text-muted-foreground/70"
										>
											<span class="font-mono">{entry.shortSha}</span>
											<span class="truncate">{entry.author}</span>
											<span class="ml-auto shrink-0 tabular-nums">{entry.date}</span>
										</span>
									</button>
								{/each}
							</div>
						{/if}
					{:else if stashEntries.length === 0}
						<p class="px-2 py-6 text-center text-xs text-muted-foreground/60">No stashes.</p>
					{:else}
						<div class="flex flex-col gap-px">
							{#each stashEntries as stash (stash.index)}
								<div
									class="group/stash flex items-center gap-2 rounded-md px-2 py-1.5 transition-colors hover:bg-accent/30"
								>
									<span class="font-mono text-xs text-muted-foreground/70">
										stash@{`{${stash.index}}`}
									</span>
									<span class="min-w-0 flex-1 truncate text-sm text-foreground/90">
										{stash.message}
									</span>
									<span class="shrink-0 text-xs tabular-nums text-muted-foreground/60">
										{stash.date}
									</span>
									<span
										class="flex shrink-0 items-center gap-1 opacity-0 transition-opacity group-hover/stash:opacity-100"
									>
										<Button
											variant="ghost"
											size="xs"
											onclick={() => onStashPop?.(stash.index)}
											disabled={!onStashPop}
											title="Pop stash"
										>
											{#snippet children()}Pop{/snippet}
										</Button>
										<Button
											variant="ghost"
											size="xs"
											onclick={() => onStashDrop?.(stash.index)}
											disabled={!onStashDrop}
											title="Drop stash"
											class="text-destructive hover:text-destructive"
										>
											{#snippet children()}Drop{/snippet}
										</Button>
									</span>
								</div>
							{/each}
						</div>
					{/if}
				</div>

				<!-- Commit composer — Status sub-view only -->
				{#if activeView === "status"}
					<div class="shrink-0 border-t border-border/30 px-3 py-2.5">
						<div class="relative">
							<textarea
								value={commitMessage}
								oninput={handleComposerInput}
								rows="3"
								placeholder="Commit message"
								class="w-full resize-none rounded-md border border-border/50 bg-background px-2.5 py-2 text-sm text-foreground placeholder:text-muted-foreground/50 focus-visible:border-ring focus-visible:outline-none"
							></textarea>
							<div class="absolute bottom-1.5 right-1.5 flex items-center gap-0.5">
								{#if onGenerate}
									<Button
										variant="ghost"
										size="icon-xs"
										onclick={onGenerate}
										disabled={generating}
										title="Generate commit message"
										aria-label="Generate commit message"
									>
										{#snippet children()}
											<Sparkle size={14} weight={generating ? "fill" : "regular"} />
										{/snippet}
									</Button>
								{/if}
								{@render commitMic?.()}
							</div>
						</div>

						<div class="mt-2 flex items-center gap-1.5">
							<Button
								variant="default"
								size="sm"
								class="flex-1"
								onclick={onCommit}
								disabled={!canCommit}
							>
								{#snippet children()}Commit{/snippet}
							</Button>
							<Button
								variant="secondary"
								size="sm"
								onclick={onCommitPush}
								disabled={!canCommitPush}
								title="Commit & push"
							>
								{#snippet children()}Commit &amp; push{/snippet}
							</Button>
							<Button
								variant="secondary"
								size="sm"
								onclick={onCommitPushPr}
								disabled={!canCommitPushPr}
								title="Commit, push &amp; create pull request"
							>
								{#snippet children()}+ PR{/snippet}
							</Button>
						</div>
					</div>
				{/if}
			</div>

			<!-- Diff pane -->
			<div class="min-h-0 flex-1 overflow-y-auto">
				{#if hasSelection && selectedDiff}
					{@render selectedDiff()}
				{:else}
					<div class="flex h-full items-center justify-center px-6">
						<p class="text-center text-xs text-muted-foreground/50">
							{activeView === "history"
								? "Select a commit to view its diff."
								: "Select a file to view its diff."}
						</p>
					</div>
				{/if}
			</div>
		</div>
	{:else}
		<!-- Commits / PRs / Worktrees: chrome only; host fills the body -->
		<div class="min-h-0 flex-1 overflow-y-auto">
			{#if activeSection === "commits"}
				{@render commitsContent?.()}
			{:else if activeSection === "prs"}
				{@render prsContent?.()}
			{:else}
				{@render worktreesContent?.()}
			{/if}
		</div>
	{/if}
</div>
