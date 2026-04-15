<script lang="ts">
import { SvelteMap } from "svelte/reactivity";
import { toast } from "svelte-sonner";
import * as m from "$lib/messages.js";
import { tauriClient } from "$lib/utils/tauri-client.js";
import { createReviewFileRevisionKey } from "../../../review/review-file-revision.js";
import {
	sessionReviewStateStore,
	toPersistedFileReviewProgress,
} from "../../../store/session-review-state-store.svelte.js";
import type { ModifiedFileEntry } from "../../../types/modified-file-entry.js";
import type { ReviewDiffViewState } from "../../modified-files/components/review-diff-view-state.svelte.js";
import type { ModifiedFilesState } from "../../modified-files/types/modified-files-state.js";
import ReviewBottomWidget from "../../review-panel/review-bottom-widget.svelte";
import ReviewPanelDiff from "../../review-panel/review-panel-diff.svelte";
import type {
	FileReviewCounters,
	PerFileReviewState,
} from "../../review-panel/review-session-state.js";
import {
	computeFileReviewStatus,
	nextSequentialFileIndex,
	prevSequentialFileIndex,
	shouldAutoAdvanceAfterFileResolution,
} from "../../review-panel/review-session-state.js";

interface Props {
	modifiedFilesState: ModifiedFilesState;
	selectedFileIndex: number;
	sessionId?: string | null;
	projectPath?: string | null;
	onClose: () => void;
	onFileIndexChange: (index: number) => void;
	isActive?: boolean;
}

let {
	modifiedFilesState,
	selectedFileIndex,
	sessionId = null,
	projectPath = null,
	onClose,
	onFileIndexChange,
	isActive = true,
}: Props = $props();

let diffViewStateRef = $state<ReviewDiffViewState | null>(null);
let fileStatuses = new SvelteMap<string, PerFileReviewState>();
type ResolvedHunkAction = {
	readonly hunkIndex: number;
	readonly action: "accept" | "reject";
};
let resolvedActionsByFile = new SvelteMap<string, ReadonlyArray<ResolvedHunkAction>>();
let hydratedRevisionSignature = $state<string | null>(null);

const selectedFile = $derived(modifiedFilesState.files[selectedFileIndex]);
const files = $derived(modifiedFilesState.files);
const fileRevisionKeys = $derived(files.map((file) => getReviewFileRevisionKey(file)));
const fileRevisionKeySignature = $derived(fileRevisionKeys.join("\u0000"));

const nextFileIdx = $derived(nextSequentialFileIndex(selectedFileIndex, files.length));
const prevFileIdx = $derived(prevSequentialFileIndex(selectedFileIndex));

const hunkStats = $derived.by(() => {
	const state = diffViewStateRef;
	if (!state) {
		return {
			hasPrev: false,
			hasNext: false,
			hasPending: false,
			hunkCurrent: 0,
			hunkTotal: 0,
		};
	}
	const stats = state.getHunkStats();
	const pending = state.getPendingHunkIndices();
	const active = state.getActiveHunkIndex();
	const activeIdx = active !== null ? pending.indexOf(active) : 0;
	const hunkCurrent = pending.length > 0 ? activeIdx + 1 : 0;
	const hunkTotal = pending.length || stats.total;
	return {
		hasPrev: pending.length > 1 && activeIdx > 0,
		hasNext: pending.length > 1 && activeIdx < pending.length - 1 && activeIdx >= 0,
		hasPending: stats.pending > 0,
		hunkCurrent,
		hunkTotal,
	};
});

const fileCurrent = $derived(selectedFileIndex + 1);
const fileTotal = $derived(files.length);

function getReviewFileRevisionKey(file: ModifiedFileEntry): string {
	return createReviewFileRevisionKey(file);
}

function updateFileStatus(
	file: ModifiedFileEntry,
	updater: (prev: PerFileReviewState | undefined) => PerFileReviewState
): PerFileReviewState {
	const fileKey = getReviewFileRevisionKey(file);
	const prev = fileStatuses.get(fileKey);
	const next = updater(prev);
	fileStatuses.set(fileKey, next);
	return next;
}

function recordResolvedAction(
	file: ModifiedFileEntry,
	hunkIndex: number,
	action: "accept" | "reject"
): void {
	const fileKey = getReviewFileRevisionKey(file);
	const existing = resolvedActionsByFile.get(fileKey) ?? [];
	resolvedActionsByFile.set(fileKey, [...existing, { hunkIndex, action }]);
}

function maybeAutoAdvanceAfterResolve(nextState: PerFileReviewState, fileIndex?: number): void {
	if (!shouldAutoAdvanceAfterFileResolution(nextState)) return;
	const resolvedIndex = fileIndex ?? selectedFileIndex;
	// Use per-file state to find next file with actual pending hunks,
	// not just "unaccepted" status (which includes fully-rejected files with 0 pending)
	for (let i = resolvedIndex + 1; i < files.length; i += 1) {
		const state = fileStatuses.get(getReviewFileRevisionKey(files[i]));
		// Untracked files (no state yet) are considered pending
		if (!state || state.pendingHunks > 0) {
			onFileIndexChange(i);
			return;
		}
	}
}

function handleHunkAccept(hunkIndex: number): void {
	if (!selectedFile) return;
	recordResolvedAction(selectedFile, hunkIndex, "accept");
	const nextState = updateFileStatus(selectedFile, (prev) => {
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
			acceptedHunks: counters.acceptedHunks,
			rejectedHunks: counters.rejectedHunks,
			pendingHunks: counters.pendingHunks,
			totalHunks: counters.totalHunks,
			status: computeFileReviewStatus(counters, false),
		};
	});
	const isLastFile = nextSequentialFileIndex(selectedFileIndex, files.length) === null;
	const pendingAfterAccept = diffViewStateRef?.getHunkStats().pending ?? nextState.pendingHunks;
	if (pendingAfterAccept === 0 && isLastFile) {
		onClose();
		return;
	}
	maybeAutoAdvanceAfterResolve(nextState);
}

function handleHunkReject(hunkIndex: number, revertedContent: string): void {
	if (!selectedFile) return;
	if (!sessionId) {
		toast.error(m.hunk_revert_failed({ error: "Missing session id" }));
		return;
	}

	// Capture file reference before async write to prevent race if selection changes
	const capturedFile = selectedFile;
	const capturedFileIndex = selectedFileIndex;

	tauriClient.fs.writeTextFile(capturedFile.filePath, revertedContent, sessionId).match(
		() => {
			toast.success(m.hunk_revert_success({ filePath: capturedFile.fileName }));
			recordResolvedAction(capturedFile, hunkIndex, "reject");
			const nextState = updateFileStatus(capturedFile, (prev) => {
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
					filePath: capturedFile.filePath,
					acceptedHunks: counters.acceptedHunks,
					rejectedHunks: counters.rejectedHunks,
					pendingHunks: counters.pendingHunks,
					totalHunks: counters.totalHunks,
					status: computeFileReviewStatus(counters, false),
				};
			});
			maybeAutoAdvanceAfterResolve(nextState, capturedFileIndex);
		},
		(error: Error) => toast.error(m.hunk_revert_failed({ error: error.message }))
	);
}

function handleDiffStateReady(state: ReviewDiffViewState): void {
	diffViewStateRef = state;
	if (selectedFile) {
		const fileKey = getReviewFileRevisionKey(selectedFile);
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
		updateFileStatus(selectedFile, () => ({
			filePath: selectedFile.filePath,
			...counters,
			status: computeFileReviewStatus(counters, false),
		}));
	}
}

function handleAcceptFile(): void {
	if (!diffViewStateRef || !selectedFile || !hunkStats.hasPending) return;
	diffViewStateRef.acceptActiveHunk();
}

function handleRejectFile(): void {
	if (!diffViewStateRef || !selectedFile || !hunkStats.hasPending) return;
	diffViewStateRef.rejectActiveHunk();
}

function handlePrevFile(): void {
	if (prevFileIdx !== null) {
		onFileIndexChange(prevFileIdx);
	}
}

function handleNextFile(): void {
	if (nextFileIdx !== null) {
		onFileIndexChange(nextFileIdx);
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

function hydrateFromPersistedSessionState(currentSessionId: string): void {
	fileStatuses.clear();
	resolvedActionsByFile.clear();

	for (const file of files) {
		const fileKey = getReviewFileRevisionKey(file);
		const persisted = sessionReviewStateStore.getFileProgress(currentSessionId, fileKey);
		if (!persisted) continue;

		fileStatuses.set(fileKey, {
			filePath: persisted.filePath,
			status: persisted.status,
			acceptedHunks: persisted.acceptedHunks,
			rejectedHunks: persisted.rejectedHunks,
			pendingHunks: persisted.pendingHunks,
			totalHunks: persisted.totalHunks,
		});
		resolvedActionsByFile.set(fileKey, persisted.resolvedActions);
	}

	sessionReviewStateStore.pruneToRevisionKeys(currentSessionId, new Set(fileRevisionKeys));
}

function handleKeydown(event: KeyboardEvent): void {
	if (!isActive) return;
	if (event.key === "Escape") {
		onClose();
	} else if (event.key === "ArrowRight" && event.metaKey) {
		handleNextFile();
	} else if (event.key === "y" && event.metaKey) {
		event.preventDefault();
		diffViewStateRef?.acceptFirstPendingHunk();
	} else if (event.key === "n" && event.metaKey) {
		event.preventDefault();
		diffViewStateRef?.rejectFirstPendingHunk();
	}
}

$effect(() => {
	const fp = selectedFile?.filePath;
	if (!fp) {
		diffViewStateRef = null;
	}
});

$effect(() => {
	const validKeys = new Set(files.map((file) => getReviewFileRevisionKey(file)));
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

$effect(() => {
	if (!sessionId) {
		hydratedRevisionSignature = null;
		return;
	}

	sessionReviewStateStore.ensureLoaded(sessionId);
});

$effect(() => {
	if (!sessionId) return;
	if (!sessionReviewStateStore.isLoaded(sessionId)) return;

	const nextSignature = `${sessionId}\u0000${fileRevisionKeySignature}`;
	if (nextSignature === hydratedRevisionSignature) return;

	hydratedRevisionSignature = nextSignature;
	hydrateFromPersistedSessionState(sessionId);
});

$effect(() => {
	if (!sessionId) return;
	if (!sessionReviewStateStore.isLoaded(sessionId)) return;

	sessionReviewStateStore.pruneToRevisionKeys(sessionId, new Set(fileRevisionKeys));
	for (const file of files) {
		const fileKey = getReviewFileRevisionKey(file);
		const status = fileStatuses.get(fileKey);
		if (!status) continue;

		sessionReviewStateStore.upsertFileProgress(
			sessionId,
			fileKey,
			toPersistedFileReviewProgress({
				filePath: status.filePath,
				status: status.status,
				acceptedHunks: status.acceptedHunks,
				rejectedHunks: status.rejectedHunks,
				pendingHunks: status.pendingHunks,
				totalHunks: status.totalHunks,
				resolvedActions: resolvedActionsByFile.get(fileKey) ?? [],
			})
		);
	}
});
</script>

<svelte:window onkeydown={handleKeydown} />

{#snippet reviewBody()}
	{#if selectedFile}
		{#key getReviewFileRevisionKey(selectedFile)}
			<ReviewPanelDiff
				file={selectedFile}
				projectPath={projectPath ?? undefined}
				{isActive}
				onHunkAccept={handleHunkAccept}
				onHunkReject={handleHunkReject}
				onDiffStateReady={handleDiffStateReady}
			/>
		{/key}
	{/if}
{/snippet}

{#snippet reviewFooter()}
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
{/snippet}

<div class="flex h-full w-full flex-col overflow-hidden">
	<div class="relative flex-1 min-h-0 overflow-hidden">
		<div class="absolute inset-0 overflow-auto">
			{@render reviewBody()}
		</div>
		{@render reviewFooter()}
	</div>
</div>
