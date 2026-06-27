<script lang="ts">
import {
	Button,
	CloseAction,
	EmbeddedPanelHeader,
	HeaderActionCell,
	HeaderTitleCell,
	ReviewWorkspaceFileList,
} from "@acepe/ui";
import { IconChevronLeft } from "@tabler/icons-svelte";
import { SvelteMap } from "svelte/reactivity";
import { Skeleton } from "$lib/components/ui/skeleton/index.js";
import { createReviewFileRevisionKey } from "../../review/review-file-revision.js";
import { fileContentCache } from "../../services/file-content-cache.svelte.js";
import type { ReviewDiffViewState } from "../modified-files/components/review-diff-view-state.svelte.js";
import type { ModifiedFilesState } from "../../types/modified-files-state.js";
import ReviewBottomWidget from "./review-bottom-widget.svelte";
import ReviewPanelDiff from "./review-panel-diff.svelte";
import type {
	FileReviewCounters,
	FileReviewStatus,
	PerFileReviewState,
} from "./review-session-state.js";
import {
	computeFileReviewStatus,
	nextSequentialFileIndex,
	prevSequentialFileIndex,
	shouldAutoAdvanceAfterFileResolution,
} from "./review-session-state.js";
import {
	buildReviewWorkspaceFileItems,
	getReviewBottomHunkStats,
} from "./review-panel-state.js";

interface Props {
	panelId: string;
	projectPath: string;
	modifiedFilesState: ModifiedFilesState;
	selectedFileIndex: number;
	width: number;
	isFullscreenEmbedded?: boolean;
	onClose: () => void;
	onResize: (panelId: string, delta: number) => void;
	onSelectFile: (index: number) => void;
}

let {
	panelId,
	projectPath,
	modifiedFilesState,
	selectedFileIndex,
	width,
	isFullscreenEmbedded = false,
	onClose,
	onResize,
	onSelectFile,
}: Props = $props();

// Resize state
let isDragging = $state(false);
let startX = $state(0);

// Diff state ref for bottom widget controls
let diffViewStateRef = $state<ReviewDiffViewState | null>(null);

// Per-file review status (UI session state, not persisted)
let fileStatuses = new SvelteMap<string, PerFileReviewState>();
type ResolvedHunkAction = {
	readonly hunkIndex: number;
	readonly action: "accept" | "reject";
};
let resolvedActionsByFile = new SvelteMap<string, ReadonlyArray<ResolvedHunkAction>>();

// Current file
const selectedFile = $derived(modifiedFilesState.files[selectedFileIndex]);
const files = $derived(modifiedFilesState.files);

const reviewFileItems = $derived.by(() => buildReviewWorkspaceFileItems(files, fileStatuses));

const nextFileIdx = $derived(nextSequentialFileIndex(selectedFileIndex, files.length));
const prevFileIdx = $derived(prevSequentialFileIndex(selectedFileIndex));

// Bottom widget state from diff when available
const hunkStats = $derived.by(() => {
	return getReviewBottomHunkStats(diffViewStateRef);
});

const fileCurrent = $derived(selectedFileIndex + 1);
const fileTotal = $derived(files.length);

const widthStyle = $derived(
	isFullscreenEmbedded
		? "min-width: 0; width: 100%; max-width: 100%;"
		: `min-width: ${width}px; width: ${width}px; max-width: ${width}px;`
);

function updateFileStatus(
	fileKey: string,
	updater: (prev: PerFileReviewState | undefined) => PerFileReviewState
): PerFileReviewState {
	const prev = fileStatuses.get(fileKey);
	const next = updater(prev);
	fileStatuses.set(fileKey, next);
	return next;
}

function recordResolvedAction(
	fileKey: string,
	hunkIndex: number,
	action: "accept" | "reject"
): void {
	const existing = resolvedActionsByFile.get(fileKey) ?? [];
	resolvedActionsByFile.set(fileKey, [...existing, { hunkIndex, action }]);
}

function maybeAutoAdvanceAfterResolve(counters: FileReviewCounters): void {
	if (!shouldAutoAdvanceAfterFileResolution(counters)) return;
	const nextFileIndex = nextSequentialFileIndex(selectedFileIndex, files.length);
	if (nextFileIndex !== null) {
		onSelectFile(nextFileIndex);
	}
}

function handleHunkAccept(hunkIndex: number): void {
	// Accept: change confirmed (already on disk), just visual
	if (!selectedFile) return;
	const fileKey = createReviewFileRevisionKey(selectedFile);
	recordResolvedAction(fileKey, hunkIndex, "accept");
	const nextState = updateFileStatus(fileKey, (prev) => {
		const stats = diffViewStateRef?.getHunkStats() ?? {
			total: prev?.totalHunks ?? 0,
			pending: (prev?.pendingHunks ?? 1) - 1,
			accepted: (prev?.acceptedHunks ?? 0) + 1,
			rejected: prev?.rejectedHunks ?? 0,
		};
		const counters: FileReviewCounters = {
			acceptedHunks: stats.accepted,
			rejectedHunks: stats.rejected,
			pendingHunks: stats.pending,
			totalHunks: stats.total,
		};
		return {
			filePath: selectedFile.filePath,
			...counters,
			status: computeFileReviewStatus(counters, false),
		};
	});
	const isLastFile = nextSequentialFileIndex(selectedFileIndex, files.length) === null;
	// Use live stats in case updater saw stale ref; close when last hunk of last file is accepted
	const pendingAfterAccept = diffViewStateRef?.getHunkStats().pending ?? nextState.pendingHunks;
	if (pendingAfterAccept === 0 && isLastFile) {
		onClose();
		return;
	}
	maybeAutoAdvanceAfterResolve(nextState);
}

function handleHunkReject(hunkIndex: number, oldContent: string): void {
	if (!selectedFile) return;

	fileContentCache.revertFileContent(selectedFile.filePath, projectPath, oldContent).match(
		() => {
			const fileKey = createReviewFileRevisionKey(selectedFile);
			recordResolvedAction(fileKey, hunkIndex, "reject");
			const nextState = updateFileStatus(fileKey, (prev) => {
				const stats = diffViewStateRef?.getHunkStats() ?? {
					total: prev?.totalHunks ?? 0,
					pending: (prev?.pendingHunks ?? 1) - 1,
					accepted: prev?.acceptedHunks ?? 0,
					rejected: (prev?.rejectedHunks ?? 0) + 1,
				};
				const counters: FileReviewCounters = {
					acceptedHunks: stats.accepted,
					rejectedHunks: stats.rejected,
					pendingHunks: stats.pending,
					totalHunks: stats.total,
				};
				return {
					filePath: selectedFile.filePath,
					...counters,
					status: computeFileReviewStatus(counters, false),
				};
			});
			maybeAutoAdvanceAfterResolve(nextState);
		},
		(err) => {
			console.error(`Failed to revert hunk ${hunkIndex}:`, err.message);
		}
	);
}

function handleDiffStateReady(state: ReviewDiffViewState): void {
	diffViewStateRef = state;
	// Sync initial status for this file
	if (selectedFile) {
		const fileKey = createReviewFileRevisionKey(selectedFile);
		const existingActions = resolvedActionsByFile.get(fileKey) ?? [];
		const initialStats = state.getHunkStats();
		if (initialStats.accepted === 0 && initialStats.rejected === 0) {
			for (const action of existingActions) {
				state.applyHunkAction(action.hunkIndex, action.action);
			}
		}
		const stats = state.getHunkStats();
		const counters: FileReviewCounters = {
			acceptedHunks: stats.accepted,
			rejectedHunks: stats.rejected,
			pendingHunks: stats.pending,
			totalHunks: stats.total,
		};
		updateFileStatus(fileKey, () => ({
			filePath: selectedFile.filePath,
			...counters,
			status: computeFileReviewStatus(counters, false),
		}));
	}
}

function handleAcceptFile(): void {
	if (!diffViewStateRef || !selectedFile || !hunkStats.hasPending) return;
	diffViewStateRef.acceptAllPendingHunks();
}

function handleRejectFile(): void {
	if (!diffViewStateRef || !selectedFile || !hunkStats.hasPending) return;
	diffViewStateRef.rejectActiveHunk();
}

function handlePrevFile(): void {
	if (prevFileIdx !== null) {
		onSelectFile(prevFileIdx);
	}
}

function handleNextFile(): void {
	if (nextFileIdx !== null) {
		onSelectFile(nextFileIdx);
	}
}

function handlePrevHunk(): void {
	diffViewStateRef?.focusPrevPendingHunk();
}

function handleNextHunk(): void {
	diffViewStateRef?.focusNextPendingHunk();
}

function _handleScrollTop(): void {
	diffViewStateRef?.scrollToTop();
}

function _handleScrollBottom(): void {
	diffViewStateRef?.scrollToBottom();
}

// Clear diff ref when switching files (ReviewPanelDiff will call onDiffStateReady for new file)
$effect(() => {
	const fp = selectedFile?.filePath;
	if (!fp) {
		diffViewStateRef = null;
	}
});

$effect(() => {
	const validKeys = new Set(files.map((file) => createReviewFileRevisionKey(file)));
	for (const key of Array.from(fileStatuses.keys())) {
		if (!validKeys.has(key)) {
			fileStatuses.delete(key);
		}
	}
	for (const key of Array.from(resolvedActionsByFile.keys())) {
		if (!validKeys.has(key)) {
			resolvedActionsByFile.delete(key);
		}
	}
});

function handlePointerDown(e: PointerEvent) {
	isDragging = true;
	startX = e.clientX;
	(e.target as HTMLElement).setPointerCapture(e.pointerId);
}

function handlePointerMove(e: PointerEvent) {
	if (!isDragging) return;
	const delta = e.clientX - startX;
	startX = e.clientX;
	onResize(panelId, delta);
}

function handlePointerUp() {
	isDragging = false;
}
</script>

<div
	class="flex flex-col h-full shrink-0 grow-0 min-h-0 bg-background border border-border rounded-lg overflow-hidden relative {isDragging
		? 'select-none'
		: ''}"
	style={widthStyle}
>
	<EmbeddedPanelHeader>
		<HeaderActionCell withDivider={false}>
			<Button
				variant="chromeIcon"
				size="chromeIcon"
				data-header-control
				onclick={onClose}
				title="Back"
				aria-label="Back"
			>
				{#snippet children()}
					<IconChevronLeft class="h-4 w-4" />
				{/snippet}
			</Button>
		</HeaderActionCell>

		<HeaderTitleCell>
			<span class="text-xs font-medium text-foreground">Review</span>
			{#if fileTotal > 0}
				<span class="text-xs text-muted-foreground">{fileCurrent}/{fileTotal}</span>
			{/if}
		</HeaderTitleCell>

		<HeaderActionCell withDivider={true}>
			<CloseAction onClose={onClose} title={"Close"} />
		</HeaderActionCell>
	</EmbeddedPanelHeader>

	<!-- Two-pane body: left file list sidebar + right diff view -->
	<div class="flex flex-1 min-h-0">
		<!-- Left sidebar: file list with review status -->
		<div class="w-44 shrink-0 border-r border-border overflow-y-auto">
			<ReviewWorkspaceFileList
				files={reviewFileItems}
				selectedIndex={selectedFileIndex}
				emptyStateLabel="No files"
				onFileSelect={onSelectFile}
			/>
		</div>

		<!-- Right pane: diff content + floating toolbar -->
		<div class="relative flex-1 min-w-0 overflow-auto">
			{#if selectedFile}
				{#key selectedFile.filePath}
					<ReviewPanelDiff
						file={selectedFile}
						{projectPath}
						onHunkAccept={handleHunkAccept}
						onHunkReject={handleHunkReject}
						onDiffStateReady={handleDiffStateReady}
					/>
				{/key}
			{:else}
				<div class="flex flex-col gap-2 p-4">
					{#each Array.from({ length: 10 }, (_, i) => i) as index (index)}
						<Skeleton class="h-4 w-full" />
					{/each}
				</div>
			{/if}

			<!-- Floating review toolbar — positioned over the diff pane -->
			{#if selectedFile}
				<ReviewBottomWidget
					hunkCurrent={hunkStats.hunkCurrent}
					hunkTotal={hunkStats.hunkTotal}
					{fileCurrent}
					{fileTotal}
					hasPrevHunk={hunkStats.hasPrev}
					hasNextHunk={hunkStats.hasNext}
					hasPrevPendingFile={prevFileIdx !== null}
					hasNextPendingFile={nextFileIdx !== null}
					hasPendingHunks={hunkStats.hasPending}
					onPrevHunk={handlePrevHunk}
					onNextHunk={handleNextHunk}
					onPrevFile={handlePrevFile}
					onNextFile={handleNextFile}
					onAcceptFile={handleAcceptFile}
					onRejectFile={handleRejectFile}
				/>
			{/if}
		</div>
	</div>

	{#if !isFullscreenEmbedded}
		<!-- Resize Edge -->
		<div
			class="absolute top-0 right-0 w-1 h-full cursor-ew-resize hover:bg-primary/20 active:bg-primary/40 transition-colors"
			role="separator"
			aria-orientation="vertical"
			tabindex="-1"
			onpointerdown={handlePointerDown}
			onpointermove={handlePointerMove}
			onpointerup={handlePointerUp}
			onpointercancel={handlePointerUp}
		></div>
	{/if}
</div>
