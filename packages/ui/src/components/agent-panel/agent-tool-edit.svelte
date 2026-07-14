<script lang="ts">
import type { WorkerPoolManager } from "@pierre/diffs/worker";

import { FilePathBadge } from "../file-path-badge/index.js";
import { HugeiconsIcon } from "../icons/index.js";
import ToolHeaderLeading from "./tool-header-leading.svelte";
import AgentToolDurationLabel from "./agent-tool-duration-label.svelte";
import type { ToolDurationTiming } from "./tool-duration.js";

import AgentToolCard from "./agent-tool-card.svelte";
import AgentToolEditDiff from "./agent-tool-edit-diff.svelte";
import {
	getEditDisplayModel,
	getEditFileName,
	getEditHeaderLabel,
	isEditInProgress,
	resolveEditHeaderState,
	resolveEditDiffs,
	shouldShowEditDiffPill,
	type AgentToolEditDiffInput,
} from "./agent-tool-edit-state.js";
import type { AgentToolStatus } from "./types.js";

interface Props {
	diffs?: readonly AgentToolEditDiffInput[];
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
	durationTiming?: ToolDurationTiming;
	/** Base path for file type SVG icons (e.g. "/svgs/icons") */
	iconBasePath?: string;
	/** Whether clicking the file should be interactive */
	interactive?: boolean;
	/** Callback when a file badge is clicked */
	onSelect?: (filePath?: string | null) => void;
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
	/** Whether the diff should start expanded. */
	defaultExpanded?: boolean;
	editingLabel?: string;
	editedLabel?: string;
	awaitingApprovalLabel?: string;
	interruptedLabel?: string;
	failedLabel?: string;
	blockedLabel?: string;
	cancelledLabel?: string;
	degradedLabel?: string;
	pendingLabel?: string;
	preparingLabel?: string;
	ariaCollapseDiff?: string;
	ariaExpandDiff?: string;
}

let {
	diffs = [],
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
	durationTiming,
	iconBasePath = "",
	interactive = false,
	onSelect,
	theme = "dark",
	themeNames,
	workerPool,
	onBeforeRender,
	unsafeCSS,
	defaultExpanded = false,
	editingLabel = "Editing",
	editedLabel = "Edited",
	awaitingApprovalLabel = "Awaiting Approval",
	interruptedLabel = "Interrupted",
	failedLabel = "Failed",
	blockedLabel = "Waiting for permission",
	cancelledLabel = "Cancelled",
	degradedLabel = "Degraded",
	pendingLabel = "Pending",
	preparingLabel = "Preparing edit…",
	ariaCollapseDiff = "Collapse diff",
	ariaExpandDiff = "Expand diff",
}: Props = $props();

const getInitialExpanded = (): boolean => defaultExpanded;

let isExpanded = $state(getInitialExpanded());

const isPending = $derived(isEditInProgress(status));
const headerState = $derived(resolveEditHeaderState(status, applied, awaitingApproval));
const headerLabel = $derived(
	getEditHeaderLabel(headerState, {
		editingLabel,
		editedLabel,
		awaitingApprovalLabel,
		interruptedLabel,
		failedLabel,
		blockedLabel,
		cancelledLabel,
		degradedLabel,
		pendingLabel,
	})
);
const showDiffPill = $derived(shouldShowEditDiffPill(status, applied, awaitingApproval));
const resolvedDiffs = $derived(
	resolveEditDiffs({
		diffs,
		filePath,
		fileName: propFileName,
		additions,
		deletions,
		oldString,
		newString,
	})
);
const displayModel = $derived(
	getEditDisplayModel({
		resolvedDiffs,
		filePath,
		fileName: propFileName,
		showDiffPill,
		additions,
		deletions,
	})
);

function toggleExpand() {
	isExpanded = !isExpanded;
}

function expand() {
	isExpanded = true;
}
</script>

<AgentToolCard>
	<!-- Header: fixed h-6 height to prevent layout shift -->
	<div role="group" class="flex h-6 items-center justify-between pl-2 pr-1.5 text-sm">
		<!-- Left side: label + file info -->
		<div class="flex items-center gap-1 truncate flex-1 min-w-0">
			{#if displayModel.displayedFilePath && !displayModel.hasMultipleDiffs}
				<div class="flex items-center gap-1 min-w-0">
					<ToolHeaderLeading kind="edit" {status}>
						{headerLabel}
					</ToolHeaderLeading>
					<FilePathBadge
						filePath={displayModel.displayedFilePath}
						fileName={displayModel.derivedFileName}
						linesAdded={displayModel.displayedAdditions}
						linesRemoved={displayModel.displayedDeletions}
						{iconBasePath}
						{interactive}
						variant="plain"
						onSelect={interactive ? () => onSelect?.(displayModel.displayedFilePath) : undefined}
					/>
				</div>
			{:else if displayModel.hasMultipleDiffs}
				<div class="flex items-center gap-1 min-w-0">
					<ToolHeaderLeading kind="edit" {status}>
						{headerLabel}
					</ToolHeaderLeading>
					<span class="truncate font-sans text-sm text-muted-foreground">
						{displayModel.displayedFileCountLabel}
					</span>
				</div>
			{:else if isPending}
				<div class="flex items-center gap-1 min-w-0">
					<ToolHeaderLeading kind="edit" {status}>{editingLabel}</ToolHeaderLeading>
				</div>
			{/if}
		</div>

		<!-- Right side: elapsed label + expand button -->
		<div class="ml-1.5 flex shrink-0 items-center gap-1.5">
			<AgentToolDurationLabel
				timing={durationTiming}
				class="font-sans text-xs"
			/>
			{#if !isPending && displayModel.hasContent}
					<button
						type="button"
						onclick={toggleExpand}
						class="flex items-center justify-center p-0.5 rounded-sm bg-transparent border-none text-muted-foreground cursor-pointer transition-colors hover:bg-muted/50 hover:text-foreground"
						aria-label={isExpanded ? ariaCollapseDiff : ariaExpandDiff}
						aria-expanded={isExpanded}
					>
						<HugeiconsIcon name="chevron-right" class="size-3 shrink-0 text-muted-foreground transition-transform duration-150 {isExpanded ? 'rotate-90' : ''}"
						/>
					</button>
				{/if}
			</div>
	</div>

	<!-- Pierre diffs content -->
	{#if displayModel.hasContent}
		{#each resolvedDiffs as diff, index (diff.filePath ?? `edit-${index}`)}
			{#if displayModel.hasMultipleDiffs}
				<div class="flex items-center gap-1.5 border-t border-border px-2.5 py-1.5 text-sm">
					{#if diff.filePath}
						<FilePathBadge
							filePath={diff.filePath}
							fileName={diff.fileName ?? null}
							linesAdded={showDiffPill ? (diff.additions ?? 0) : 0}
							linesRemoved={showDiffPill ? (diff.deletions ?? 0) : 0}
							{iconBasePath}
							{interactive}
							onSelect={interactive ? () => onSelect?.(diff.filePath) : undefined}
						/>
					{:else}
						<span class="font-sans text-sm text-muted-foreground">
							Edit {index + 1}
						</span>
					{/if}
				</div>
			{/if}
			<AgentToolEditDiff
				oldString={diff.oldString ?? null}
				newString={diff.newString}
				fileName={
					diff.fileName ??
					getEditFileName(diff.filePath) ??
					displayModel.derivedFileName
				}
				{isExpanded}
				{isStreaming}
				onExpandClick={expand}
				{theme}
				{themeNames}
				{workerPool}
				{onBeforeRender}
				{unsafeCSS}
			/>
		{/each}
	{/if}
</AgentToolCard>
