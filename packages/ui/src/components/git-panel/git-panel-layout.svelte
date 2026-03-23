<script lang="ts">
	/**
	 * GitPanelLayout — Composed layout for the git panel.
	 * Header (branch + remote actions) → view tabs → content area → commit box.
	 * All data-driven via props, no Tauri coupling.
	 */
	import type { Snippet } from "svelte";
	import ArrowUp from "phosphor-svelte/lib/ArrowUp";
	import ArrowDown from "phosphor-svelte/lib/ArrowDown";
	import ArrowsClockwise from "phosphor-svelte/lib/ArrowsClockwise";
	import GitDiff from "phosphor-svelte/lib/GitDiff";
	import ClockCounterClockwise from "phosphor-svelte/lib/ClockCounterClockwise";
	import Package from "phosphor-svelte/lib/Package";

	import { cn } from "../../lib/utils.js";
	import type { GitStatusFile, GitStashEntry, GitLogEntry, GitLogEntryFile, GitRemoteStatus } from "./types.js";
	import GitBranchBadge from "./git-branch-badge.svelte";
	import GitRemoteStatusBadge from "./git-remote-status.svelte";
	import GitStatusList from "./git-status-list.svelte";
	import GitCommitBox from "./git-commit-box.svelte";
	import GitStashList from "./git-stash-list.svelte";
	import GitLogList from "./git-log-list.svelte";
	import { SegmentedToggleGroup } from "../panel-header/index.js";

	type ViewTab = "status" | "history" | "stash";

	interface Props {
		/** Current branch name */
		branch: string;
		/** Files staged for commit */
		stagedFiles: GitStatusFile[];
		/** Unstaged/untracked files */
		unstagedFiles: GitStatusFile[];
		/** Remote ahead/behind status */
		remoteStatus?: GitRemoteStatus | null;
		/** Commit message (controlled) */
		commitMessage?: string;
		/** Stash entries */
		stashEntries?: GitStashEntry[];
		/** Commit history */
		logEntries?: GitLogEntry[];
		/** Active view tab */
		activeView?: ViewTab;

		// Callbacks
		onBranchClick?: () => void;
		onStage?: (path: string) => void;
		onUnstage?: (path: string) => void;
		onStageAll?: () => void;
		onDiscard?: (path: string) => void;
		onCommitMessageChange?: (message: string) => void;
		onCommit?: (message: string) => void;
		onGenerate?: () => void;
		generating?: boolean;
		onPush?: () => void;
		onPull?: () => void;
		onFetch?: () => void;
		onViewChange?: (view: ViewTab) => void;
		onStashPop?: (index: number) => void;
		onStashDrop?: (index: number) => void;
		onLogSelect?: (sha: string) => void;
		onLogExpand?: (sha: string) => void;
		/** Files for expanded commits in the history tab, keyed by SHA */
		expandedCommitFiles?: Record<string, GitLogEntryFile[]>;
		/** Snippet for rendering a file's diff inline in the history tab */
		logFileDiffContent?: Snippet<[{ file: GitLogEntryFile }]>;

		/** Callback when a file is selected (for showing diff). Receives path and whether the file is staged. */
		onFileSelect?: (path: string, staged: boolean) => void;
		/** Currently selected file path (for highlighting) */
		selectedFile?: string;

		/** Base path for file-type SVG icons (e.g. "/svgs/icons"). Falls back to Phosphor icons if omitted. */
		iconBasePath?: string;
		class?: string;
	}

	let {
		branch,
		stagedFiles,
		unstagedFiles,
		remoteStatus = null,
		commitMessage = "",
		stashEntries = [],
		logEntries = [],
		activeView = "status",
		onBranchClick,
		onStage,
		onUnstage,
		onStageAll,
		onDiscard,
		onCommitMessageChange,
		onCommit,
		onGenerate,
		generating = false,
		onPush,
		onPull,
		onFetch,
		onViewChange,
		onStashPop,
		onStashDrop,
		onLogSelect,
		onLogExpand,
		expandedCommitFiles = {},
		logFileDiffContent,
		onFileSelect,
		selectedFile = "",
		iconBasePath,
		class: className,
	}: Props = $props();

	const views: { value: ViewTab; label: string; icon: typeof GitDiff }[] = [
		{ value: "status", label: "Status", icon: GitDiff },
		{ value: "history", label: "History", icon: ClockCounterClockwise },
		{ value: "stash", label: "Stash", icon: Package },
	];
</script>

<div class={cn("flex flex-col h-full bg-background", className)}>
	<!-- Header: branch + remote status + action buttons -->
	<div class="flex items-center gap-2 px-2 py-1.5 border-b border-border/30 shrink-0">
		<GitBranchBadge {branch} onclick={onBranchClick} />
		<GitRemoteStatusBadge status={remoteStatus} />

		<div class="flex-1"></div>

		<div class="flex items-center gap-0.5">
			{#if onFetch}
				<button
					type="button"
					class="flex items-center justify-center h-6 w-6 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted/50 cursor-pointer transition-colors"
					title="Fetch"
					onclick={onFetch}
				>
					<ArrowsClockwise size={14} weight="bold" />
				</button>
			{/if}
			{#if onPull}
				<button
					type="button"
					class="flex items-center justify-center h-6 w-6 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted/50 cursor-pointer transition-colors"
					title="Pull"
					onclick={onPull}
				>
					<ArrowDown size={14} weight="bold" />
				</button>
			{/if}
			{#if onPush}
				<button
					type="button"
					class="flex items-center justify-center h-6 w-6 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted/50 cursor-pointer transition-colors"
					title="Push"
					onclick={onPush}
				>
					<ArrowUp size={14} weight="bold" />
				</button>
			{/if}
		</div>
	</div>

	<!-- View tabs -->
	<div class="flex items-center gap-0 px-2 py-1 border-b border-border/30 shrink-0">
		<SegmentedToggleGroup
			items={views.map((view) => ({ id: view.value, label: view.label }))}
			value={activeView}
			onChange={(id) => onViewChange?.(id as ViewTab)}
		>
			{#snippet itemContent(item)}
				{@const view = views.find((candidate) => candidate.value === item.id)}
				{#if view}
					<view.icon size={12} weight="bold" />
				{/if}
				{item.label}
				{#if item.id === "stash" && stashEntries.length > 0}
					<span class="text-[0.5625rem] text-muted-foreground">({stashEntries.length})</span>
				{/if}
			{/snippet}
		</SegmentedToggleGroup>
	</div>

	<!-- Content area -->
	<div class="flex-1 min-h-0 overflow-hidden">
		{#if activeView === "status"}
			<GitStatusList
				{stagedFiles}
				{unstagedFiles}
				{iconBasePath}
				{onStage}
				{onUnstage}
				{onStageAll}
				{onDiscard}
				{onFileSelect}
				{selectedFile}
				class="h-full"
			/>
		{:else if activeView === "history"}
			<GitLogList
				entries={logEntries}
				{expandedCommitFiles}
				onExpand={onLogExpand}
				onSelect={onLogSelect}
				fileDiffContent={logFileDiffContent}
				{iconBasePath}
				class="h-full"
			/>
		{:else if activeView === "stash"}
			<GitStashList entries={stashEntries} onPop={onStashPop} onDrop={onStashDrop} class="h-full" />
		{/if}
	</div>

	<!-- Commit box (only visible in status view) -->
	{#if activeView === "status"}
		<GitCommitBox
			message={commitMessage}
			onMessageChange={onCommitMessageChange ?? (() => {})}
			onCommit={onCommit ?? (() => {})}
			{onGenerate}
			{generating}
			disabled={stagedFiles.length === 0}
		/>
	{/if}
</div>
