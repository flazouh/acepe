<script lang="ts">
import { SvelteMap } from "svelte/reactivity";
import { toast } from "svelte-sonner";
import { fileContentCache } from "$lib/acp/services/file-content-cache.svelte.js";
import { tauriClient } from "$lib/utils/tauri-client.js";
import { createReviewFileRevisionKey } from "../../../review/review-file-revision.js";
import {
	sessionReviewStateStore,
	type PersistedFileReviewProgress,
	toPersistedFileReviewProgress,
} from "../../../store/session-review-state-store.svelte.js";
import type { ModifiedFileEntry } from "../../../types/modified-file-entry.js";
import type { ReviewDiffViewState } from "../../modified-files/components/review-diff-view-state.svelte.js";
import type { ReviewDiffDensity } from "../../modified-files/components/review-diff-view-state.svelte.js";
import type { ModifiedFilesState } from "../../../types/modified-files-state.js";
import ReviewBottomWidget from "../../review-panel/review-bottom-widget.svelte";
import ReviewPanelDiff from "../../review-panel/review-panel-diff.svelte";
import type {
	FileReviewCounters,
	PerFileReviewState,
} from "../../review-panel/review-session-state.js";
import {
	computeFileReviewStatus,
	findNextReviewableFileIndex,
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
	onKeepActionChange?: (action: (() => void) | null, disabled: boolean) => void;
	isActive?: boolean;
	onExpandToFullscreen?: () => void;
	diffDensity?: ReviewDiffDensity;
}

let {
	modifiedFilesState,
	selectedFileIndex,
	sessionId = null,
	projectPath = null,
	onClose,
	onFileIndexChange,
	onKeepActionChange,
	isActive = true,
	onExpandToFullscreen: _onExpandToFullscreen = undefined,
	diffDensity = "default",
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
const selectedFileResolvedActions = $derived.by(() => {
	if (!selectedFile) {
		return [];
	}

	const fileKey = getReviewFileRevisionKey(selectedFile);
	return (
		resolvedActionsByFile.get(fileKey) ??
		getPersistedReviewProgress(selectedFile)?.resolvedActions ??
		[]
	);
});
const selectedFileReviewState = $derived.by(() => {
	if (!selectedFile) {
		return undefined;
	}

	return getCurrentFileReviewState(selectedFile);
});
const selectedFileIsResolved = $derived(selectedFileReviewState?.pendingHunks === 0);

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
	const pending = selectedFileIsResolved ? [] : state.getPendingHunkIndices();
	const active = state.getActiveHunkIndex();
	const activeIdx = active !== null ? pending.indexOf(active) : 0;
	const hunkCurrent = pending.length > 0 ? activeIdx + 1 : 0;
	const hunkTotal = pending.length || selectedFileReviewState?.totalHunks || stats.total;
	return {
		hasPrev: pending.length > 1 && activeIdx > 0,
		hasNext: pending.length > 1 && activeIdx < pending.length - 1 && activeIdx >= 0,
		hasPending: !selectedFileIsResolved && stats.pending > 0,
		hunkCurrent,
		hunkTotal,
	};
});

const fileCurrent = $derived(selectedFileIndex + 1);
const fileTotal = $derived(files.length);

function getReviewFileRevisionKey(file: ModifiedFileEntry): string {
	return createReviewFileRevisionKey(file);
}

function mapPersistedProgressToReviewState(
	progress: PersistedFileReviewProgress
): PerFileReviewState {
	return {
		filePath: progress.filePath,
		status: progress.status,
		acceptedHunks: progress.acceptedHunks,
		rejectedHunks: progress.rejectedHunks,
		pendingHunks: progress.pendingHunks,
		totalHunks: progress.totalHunks,
	};
}

function getPersistedReviewProgress(file: ModifiedFileEntry): PersistedFileReviewProgress | null {
	if (!sessionId) {
		return null;
	}

	if (!sessionReviewStateStore.isLoaded(sessionId)) {
		return null;
	}

	return sessionReviewStateStore.getFileProgress(sessionId, getReviewFileRevisionKey(file));
}

function getCurrentFileReviewState(file: ModifiedFileEntry): PerFileReviewState | undefined {
	const persisted = getPersistedReviewProgress(file);
	if (persisted?.pendingHunks === 0) {
		return mapPersistedProgressToReviewState(persisted);
	}

	const local = fileStatuses.get(getReviewFileRevisionKey(file));
	if (local) {
		return local;
	}

	return persisted ? mapPersistedProgressToReviewState(persisted) : undefined;
}

function persistFileStatus(fileKey: string, status: PerFileReviewState): void {
	if (!sessionId) {
		return;
	}

	if (!sessionReviewStateStore.isLoaded(sessionId)) {
		return;
	}

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

function updateFileStatus(
	file: ModifiedFileEntry,
	updater: (prev: PerFileReviewState | undefined) => PerFileReviewState
): PerFileReviewState {
	const fileKey = getReviewFileRevisionKey(file);
	const prev = fileStatuses.get(fileKey);
	const next = updater(prev);
	fileStatuses.set(fileKey, next);
	persistFileStatus(fileKey, next);
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

	const nextReviewableIndex = findNextReviewableFileIndex(
		resolvedIndex,
		files.map((file) => fileStatuses.get(getReviewFileRevisionKey(file)))
	);
	if (nextReviewableIndex !== null) {
		onFileIndexChange(nextReviewableIndex);
		return;
	}

	onClose();
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
	maybeAutoAdvanceAfterResolve(nextState);
}

function handleHunkReject(hunkIndex: number, revertedContent: string): void {
	if (!selectedFile) return;
	if (!sessionId && !projectPath) {
		toast.error(`Failed to revert: ${"Missing session id and project path"}`);
		return;
	}

	// Capture file reference before async write to prevent race if selection changes
	const capturedFile = selectedFile;
	const capturedFileIndex = selectedFileIndex;
	const capturedDiffState = diffViewStateRef;

	const writeResult = projectPath
		? fileContentCache.revertFileContent(capturedFile.filePath, projectPath, revertedContent)
		: tauriClient.fs.writeTextFile(capturedFile.filePath, revertedContent, sessionId ?? "");

	writeResult.match(
		() => {
			toast.success(`Reverted changes in ${capturedFile.fileName}`);
			recordResolvedAction(capturedFile, hunkIndex, "reject");
			const nextState = updateFileStatus(capturedFile, (prev) => {
				const stats = capturedDiffState?.getHunkStats() ?? {
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
		(error: Error) => toast.error(`Failed to revert: ${error.message}`)
	);
}

function handleDiffStateReady(state: ReviewDiffViewState): void {
	diffViewStateRef = state;
	if (selectedFile) {
		const fileKey = getReviewFileRevisionKey(selectedFile);
		const existingStatus = getCurrentFileReviewState(selectedFile);
		if (existingStatus?.pendingHunks === 0) {
			fileStatuses.set(fileKey, existingStatus);
			const persisted = getPersistedReviewProgress(selectedFile);
			if (persisted) {
				resolvedActionsByFile.set(fileKey, persisted.resolvedActions);
			}
			return;
		}

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
	diffViewStateRef.acceptAllPendingHunks();
}

function handleHeaderKeepFile(): void {
	handleAcceptFile();
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
	if (!onKeepActionChange) return;

	const disabled = !selectedFile || !hunkStats.hasPending;
	onKeepActionChange(disabled ? null : handleHeaderKeepFile, disabled);

	return () => {
		onKeepActionChange(null, true);
	};
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
				density={diffDensity}
				initialResolvedActions={selectedFileResolvedActions}
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
	<div class="relative flex min-h-0 flex-1 flex-col overflow-hidden">
		<div class="min-h-0 flex-1 overflow-auto pb-10">
			{@render reviewBody()}
		</div>
		{@render reviewFooter()}
	</div>
</div>
