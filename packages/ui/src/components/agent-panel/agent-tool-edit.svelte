<script lang="ts">
	import type { WorkerPoolManager } from "@pierre/diffs/worker";
	import CaretRight from "phosphor-svelte/lib/CaretRight";

	import { FilePathBadge } from "../file-path-badge/index.js";
	import { TextShimmer } from "../text-shimmer/index.js";
	import ToolLabel from "./tool-label.svelte";

	import AgentToolCard from "./agent-tool-card.svelte";
	import AgentToolEditDiff from "./agent-tool-edit-diff.svelte";
	import {
		isEditInProgress,
		resolveEditHeaderState,
		shouldShowEditDiffPill,
	} from "./agent-tool-edit-state.js";
	import type { AgentToolStatus } from "./types.js";

	interface Props {
		/** File path being edited */
		filePath?: string | null;
		/** File name (extracted from filePath if not provided) */
		fileName?: string | null;
		/** Lines added (from diff stats) */
		additions?: number;
		/** Lines removed (from diff stats) */
		deletions?: number;
		/** The old string content (what was replaced). */
		oldString?: string | null;
		/** The new string content (the replacement). */
		newString?: string | null;
		/** Whether content is currently streaming. */
		isStreaming?: boolean;
		/** Tool status */
		status?: AgentToolStatus;
		/** Whether this edit is known to be applied (tool completed successfully). */
		applied?: boolean;
		/** Whether this edit is currently waiting for user approval. */
		awaitingApproval?: boolean;
		/** Optional elapsed label shown in the header (e.g. "for 2.34s") */
		durationLabel?: string;
		/** Base path for file type SVG icons (e.g. "/svgs/icons") */
		iconBasePath?: string;
		/** Whether clicking the file should be interactive */
		interactive?: boolean;
		/** Callback when file badge is clicked */
		onSelect?: () => void;
		/** Theme type for syntax highlighting. Defaults to "dark". */
		theme?: "light" | "dark";
		/** Theme names to use. Defaults to pierre built-in themes. */
		themeNames?: { dark: string; light: string };
		/** Optional worker pool for non-blocking syntax highlighting. */
		workerPool?: WorkerPoolManager;
		/** Optional async callback invoked before first render (e.g. for theme registration). */
		onBeforeRender?: () => Promise<void>;
		/** Optional CSS injected into the Pierre diffs shadow DOM. */
		unsafeCSS?: string;
		editingLabel?: string;
		editedLabel?: string;
		awaitingApprovalLabel?: string;
		interruptedLabel?: string;
		failedLabel?: string;
		pendingLabel?: string;
		preparingLabel?: string;
		ariaCollapseDiff?: string;
		ariaExpandDiff?: string;
	}

	let {
		filePath,
		fileName: propFileName,
		additions = 0,
		deletions = 0,
		oldString = null,
		newString = null,
		isStreaming = false,
		status = "done",
		applied = status === "done",
		awaitingApproval = false,
		durationLabel,
		iconBasePath = "",
		interactive = false,
		onSelect,
		theme = "dark",
		themeNames,
		workerPool,
		onBeforeRender,
		unsafeCSS,
		editingLabel = "Editing",
		editedLabel = "Edited",
		awaitingApprovalLabel = "Awaiting Approval",
		interruptedLabel = "Interrupted",
		failedLabel = "Failed",
		pendingLabel = "Pending",
		preparingLabel = "Preparing edit…",
		ariaCollapseDiff = "Collapse diff",
		ariaExpandDiff = "Expand diff",
	}: Props = $props();

	let isExpanded = $state(true);

	const isPending = $derived(isEditInProgress(status));
	const headerState = $derived(resolveEditHeaderState(status, applied, awaitingApproval));
	const showDiffPill = $derived(shouldShowEditDiffPill(status, applied, awaitingApproval));
	const displayedAdditions = $derived(showDiffPill ? additions : 0);
	const displayedDeletions = $derived(showDiffPill ? deletions : 0);
	const hasContent = $derived(newString !== null);
	const derivedFileName = $derived(
		propFileName ?? (filePath ? (filePath.split("/").pop() ?? filePath) : null)
	);

	function toggleExpand() {
		isExpanded = !isExpanded;
	}

	function expand() {
		isExpanded = true;
	}
</script>

<AgentToolCard>
	<!-- Header: fixed h-7 height to prevent layout shift -->
	<div role="group" class="flex h-7 items-center justify-between pl-2.5 pr-2 text-xs">
		<!-- Left side: label + file info -->
		<div class="flex items-center gap-1.5 truncate flex-1 min-w-0">
			{#if filePath}
				<div class="flex items-center gap-1.5 min-w-0">
					<ToolLabel {status}>
						{#if headerState === "editing"}
							{editingLabel}
						{:else if headerState === "edited"}
							{editedLabel}
						{:else if headerState === "awaitingApproval"}
							{awaitingApprovalLabel}
						{:else if headerState === "interrupted"}
							{interruptedLabel}
						{:else if headerState === "failed"}
							{failedLabel}
						{:else}
							{pendingLabel}
						{/if}
					</ToolLabel>
					<FilePathBadge
						{filePath}
						fileName={derivedFileName}
						linesAdded={displayedAdditions}
						linesRemoved={displayedDeletions}
						{iconBasePath}
						{interactive}
						{onSelect}
					/>
				</div>
		{:else if isPending}
			<TextShimmer class="text-muted-foreground" duration={1.2}>{preparingLabel}</TextShimmer>
			{/if}
		</div>

		<!-- Right side: elapsed label + expand button -->
		{#if durationLabel || (!isPending && hasContent && filePath)}
			<div class="ml-2 flex shrink-0 items-center gap-2">
				{#if durationLabel}
					<span class="font-mono text-[10px] text-muted-foreground/70">{durationLabel}</span>
				{/if}
				{#if !isPending && hasContent && filePath}
					<button
						type="button"
						onclick={toggleExpand}
						class="flex items-center justify-center p-1 rounded-sm bg-transparent border-none text-muted-foreground cursor-pointer transition-colors hover:bg-muted/50 hover:text-foreground"
						aria-label={isExpanded ? ariaCollapseDiff : ariaExpandDiff}
						aria-expanded={isExpanded}
					>
						<CaretRight
							size={10}
							weight="bold"
							class="text-muted-foreground transition-transform duration-150 {isExpanded ? 'rotate-90' : ''}"
						/>
					</button>
				{/if}
			</div>
		{/if}
	</div>

	<!-- Pierre diffs content -->
	{#if hasContent}
		<AgentToolEditDiff
			{oldString}
			{newString}
			fileName={derivedFileName}
			{isExpanded}
			{isStreaming}
			onExpandClick={expand}
			{theme}
			{themeNames}
			{workerPool}
			{onBeforeRender}
			{unsafeCSS}
		/>
	{/if}
</AgentToolCard>
