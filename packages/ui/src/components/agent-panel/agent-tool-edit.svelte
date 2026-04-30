<script lang="ts">
import type { WorkerPoolManager } from "@pierre/diffs/worker";
import { CaretRight } from "phosphor-svelte";

import { FilePathBadge } from "../file-path-badge/index.js";
import ToolHeaderLeading from "./tool-header-leading.svelte";

import AgentToolCard from "./agent-tool-card.svelte";
import AgentToolEditDiff from "./agent-tool-edit-diff.svelte";
import {
	isEditInProgress,
	resolveEditHeaderState,
	shouldShowEditDiffPill,
} from "./agent-tool-edit-state.js";
import type { AgentToolStatus } from "./types.js";

type AgentToolEditDiffEntry = {
	filePath?: string | null;
	fileName?: string | null;
	additions?: number;
	deletions?: number;
	oldString?: string | null;
	newString?: string | null;
};

interface Props {
	diffs?: readonly AgentToolEditDiffEntry[];
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
	durationLabel,
	iconBasePath = "",
	interactive = false,
	onSelect,
	theme = "dark",
	themeNames,
	workerPool,
	onBeforeRender,
	unsafeCSS,
	defaultExpanded = true,
	editingLabel = "Editing",
	editedLabel = "Edited",
	awaitingApprovalLabel = "Awaiting Approval",
	interruptedLabel = "Interrupted",
	failedLabel = "Failed",
	blockedLabel = "Blocked",
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
const showDiffPill = $derived(shouldShowEditDiffPill(status, applied, awaitingApproval));
const displayedAdditions = $derived(showDiffPill ? additions : 0);
const displayedDeletions = $derived(showDiffPill ? deletions : 0);
const resolvedDiffs = $derived.by(() => {
	if (diffs.length > 0) {
		return diffs.filter((diff): diff is AgentToolEditDiffEntry & { newString: string } => {
			return typeof diff.newString === "string";
		});
	}

	if (newString === null) {
		return [];
	}

	return [
		{
			filePath,
			fileName: propFileName ?? (filePath ? (filePath.split("/").pop() ?? filePath) : null),
			additions,
			deletions,
			oldString,
			newString,
		},
	];
});
const hasMultipleDiffs = $derived(resolvedDiffs.length > 1);
const primaryDiff = $derived(resolvedDiffs[0] ?? null);
const hasContent = $derived(resolvedDiffs.length > 0);
const derivedFileName = $derived(
	primaryDiff?.fileName ??
		propFileName ??
		(primaryDiff?.filePath
			? (primaryDiff.filePath.split("/").pop() ?? primaryDiff.filePath)
			: filePath
				? (filePath.split("/").pop() ?? filePath)
				: null)
);
const displayedFilePath = $derived(primaryDiff?.filePath ?? filePath ?? null);
const displayedFileCountLabel = $derived(
	resolvedDiffs.length === 1 ? null : `${resolvedDiffs.length} files`
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
	<div role="group" class="flex h-7 items-center justify-between pl-2.5 pr-2 text-sm">
		<!-- Left side: label + file info -->
		<div class="flex items-center gap-1.5 truncate flex-1 min-w-0">
			{#if displayedFilePath && !hasMultipleDiffs}
				<div class="flex items-center gap-1.5 min-w-0">
					<ToolHeaderLeading kind="edit" {status}>
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
						{:else if headerState === "blocked"}
							{blockedLabel}
						{:else if headerState === "cancelled"}
							{cancelledLabel}
						{:else if headerState === "degraded"}
							{degradedLabel}
						{:else}
							{pendingLabel}
						{/if}
					</ToolHeaderLeading>
					<FilePathBadge
						filePath={displayedFilePath}
						fileName={derivedFileName}
						linesAdded={displayedAdditions}
						linesRemoved={displayedDeletions}
						{iconBasePath}
						{interactive}
						onSelect={interactive ? () => onSelect?.(displayedFilePath) : undefined}
					/>
				</div>
			{:else if hasMultipleDiffs}
				<div class="flex items-center gap-1.5 min-w-0">
					<ToolHeaderLeading kind="edit" {status}>
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
						{:else if headerState === "blocked"}
							{blockedLabel}
						{:else if headerState === "cancelled"}
							{cancelledLabel}
						{:else if headerState === "degraded"}
							{degradedLabel}
						{:else}
							{pendingLabel}
						{/if}
					</ToolHeaderLeading>
					<span class="truncate font-mono text-sm text-muted-foreground">
						{displayedFileCountLabel}
					</span>
				</div>
			{:else if isPending}
				<div class="flex items-center gap-1.5 min-w-0">
					<ToolHeaderLeading kind="edit" {status}>{editingLabel}</ToolHeaderLeading>
				</div>
			{/if}
		</div>

		<!-- Right side: elapsed label + expand button -->
		{#if durationLabel || (!isPending && hasContent)}
			<div class="ml-2 flex shrink-0 items-center gap-2">
				{#if durationLabel}
					<span class="font-mono text-sm text-muted-foreground/70">{durationLabel}</span>
				{/if}
				{#if !isPending && hasContent}
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
		{#each resolvedDiffs as diff, index (diff.filePath ?? `edit-${index}`)}
			{#if hasMultipleDiffs}
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
						<span class="font-mono text-sm text-muted-foreground">
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
					(diff.filePath ? (diff.filePath.split("/").pop() ?? diff.filePath) : derivedFileName)
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
