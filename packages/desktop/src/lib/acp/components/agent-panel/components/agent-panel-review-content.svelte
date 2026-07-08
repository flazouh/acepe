<script lang="ts">
import { SvelteSet } from "svelte/reactivity";
import { toast } from "svelte-sonner";
import { tauriClient } from "$lib/utils/tauri-client.js";
import { createReviewFileRevisionKey } from "../../../review/review-file-revision.js";
import {
	sessionReviewStateStore,
	toPersistedFileReviewProgress,
} from "../../../store/session-review-state-store.svelte.js";
import type { ReviewControlsSnapshot } from "./agent-panel-review-content-types.js";
import type { ModifiedFileEntry } from "../../../types/modified-file-entry.js";
import type {
	DiffViewStyle,
	ReviewDiffDensity,
	ReviewDiffOptions,
} from "../../modified-files/components/review-diff-view-state.svelte.js";
import type { ModifiedFilesState } from "../../../types/modified-files-state.js";
import ReviewPanelDiff from "../../review-panel/review-panel-diff.svelte";
import type { FileReviewStatus } from "../../review-panel/review-session-state.js";
import {
	nextSequentialFileIndex,
	prevSequentialFileIndex,
} from "../../review-panel/review-session-state.js";
import {
	findStaleReviewStateKeys,
	resolveAgentPanelReviewKeyAction,
	resolveReviewAutoAdvanceAction,
	resolveReviewHydrationAction,
} from "../logic/agent-panel-review-content-state.js";

interface Props {
	modifiedFilesState: ModifiedFilesState;
	selectedFileIndex: number;
	sessionId?: string | null;
	projectPath?: string | null;
	onClose: () => void;
	onFileIndexChange: (index: number) => void;
	onControlsChange?: (controls: ReviewControlsSnapshot | null) => void;
	hideBottomWidget?: boolean;
	isActive?: boolean;
	onExpandToFullscreen?: () => void;
	diffDensity?: ReviewDiffDensity;
	diffStyle?: DiffViewStyle;
	diffOptions?: ReviewDiffOptions;
}

export type { ReviewControlsSnapshot };

let {
	modifiedFilesState,
	selectedFileIndex,
	sessionId = null,
	projectPath = null,
	onClose,
	onFileIndexChange,
	onControlsChange,
	hideBottomWidget: _hideBottomWidget = false,
	isActive = true,
	onExpandToFullscreen: _onExpandToFullscreen = undefined,
	diffDensity = "default",
	diffStyle = "unified",
	diffOptions,
}: Props = $props();

// Per-file reviewed set, keyed by the file revision key.
const reviewedKeys = new SvelteSet<string>();
let hydratedRevisionSignature = $state<string | null>(null);

const selectedFile = $derived(modifiedFilesState.files[selectedFileIndex]);
const files = $derived(modifiedFilesState.files);
const fileRevisionKeys = $derived(files.map((file) => getReviewFileRevisionKey(file)));
const fileRevisionKeySignature = $derived(fileRevisionKeys.join("\u0000"));

const selectedFileIsReviewed = $derived.by(() => {
	if (!selectedFile) return false;
	return reviewedKeys.has(getReviewFileRevisionKey(selectedFile));
});

const nextFileIdx = $derived(nextSequentialFileIndex(selectedFileIndex, files.length));
const prevFileIdx = $derived(prevSequentialFileIndex(selectedFileIndex));

const fileCurrent = $derived(selectedFileIndex + 1);
const fileTotal = $derived(files.length);

function getReviewFileRevisionKey(file: ModifiedFileEntry): string {
	return createReviewFileRevisionKey(file);
}

function persistFileReviewed(fileKey: string, filePath: string, reviewed: boolean): void {
	if (!sessionId) return;
	if (!sessionReviewStateStore.isLoaded(sessionId)) return;

	sessionReviewStateStore.upsertFileProgress(
		sessionId,
		fileKey,
		toPersistedFileReviewProgress({ filePath, reviewed })
	);
}

function setFileReviewed(file: ModifiedFileEntry, reviewed: boolean): void {
	const fileKey = getReviewFileRevisionKey(file);
	if (reviewed) {
		reviewedKeys.add(fileKey);
	} else {
		reviewedKeys.delete(fileKey);
	}
	persistFileReviewed(fileKey, file.filePath, reviewed);
}

function handleToggleReviewed(): void {
	if (!selectedFile) return;

	const becameReviewed = !reviewedKeys.has(getReviewFileRevisionKey(selectedFile));
	setFileReviewed(selectedFile, becameReviewed);

	const nextStatuses: FileReviewStatus[] = files.map((file) =>
		reviewedKeys.has(getReviewFileRevisionKey(file)) ? "reviewed" : "unreviewed"
	);
	const action = resolveReviewAutoAdvanceAction({
		becameReviewed,
		resolvedIndex: selectedFileIndex,
		fileStatuses: nextStatuses,
	});

	if (action.kind === "select") {
		onFileIndexChange(action.index);
	}
}

function handleRevertFile(): void {
	if (!selectedFile) return;
	if (!projectPath) {
		toast.error("Failed to revert: no project path");
		return;
	}

	const capturedFile = selectedFile;
	tauriClient.git.discardChanges(projectPath, [capturedFile.filePath]).match(
		() => {
			toast.success(`Reverted changes in ${capturedFile.fileName}`);
		},
		(error: Error) => toast.error(`Failed to revert: ${error.message}`)
	);
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

function hydrateFromPersistedSessionState(currentSessionId: string): void {
	reviewedKeys.clear();

	for (const file of files) {
		const fileKey = getReviewFileRevisionKey(file);
		const persisted = sessionReviewStateStore.getFileProgress(currentSessionId, fileKey);
		if (persisted?.reviewed) {
			reviewedKeys.add(fileKey);
		}
	}

	sessionReviewStateStore.pruneToRevisionKeys(currentSessionId, new Set(fileRevisionKeys));
}

function handleKeydown(event: KeyboardEvent): void {
	const action = resolveAgentPanelReviewKeyAction({
		isActive,
		key: event.key,
		metaKey: event.metaKey,
	});

	if (action.kind === "none") return;

	if (action.kind === "close") {
		onClose();
	} else if (action.kind === "next-file") {
		handleNextFile();
	}
}

$effect(() => {
	if (!onControlsChange) return;

	if (!selectedFile) {
		onControlsChange(null);
		return () => onControlsChange(null);
	}

	onControlsChange({
		fileCurrent,
		fileTotal,
		isReviewed: selectedFileIsReviewed,
		onToggleReviewed: handleToggleReviewed,
		onRevertFile: handleRevertFile,
		hasPrevFile: prevFileIdx !== null,
		hasNextFile: nextFileIdx !== null,
		onPrevFile: handlePrevFile,
		onNextFile: handleNextFile,
	});

	return () => {
		onControlsChange(null);
	};
});

$effect(() => {
	const validKeys = new Set(files.map((file) => getReviewFileRevisionKey(file)));
	for (const key of findStaleReviewStateKeys({
		existingKeys: reviewedKeys,
		validKeys,
	})) {
		reviewedKeys.delete(key);
	}
});

$effect(() => {
	if (!sessionId) {
		if (hydratedRevisionSignature !== null) {
			hydratedRevisionSignature = null;
		}
		return;
	}

	sessionReviewStateStore.ensureLoaded(sessionId);
});

$effect(() => {
	const action = resolveReviewHydrationAction({
		sessionId,
		isLoaded: sessionId ? sessionReviewStateStore.isLoaded(sessionId) : false,
		fileRevisionKeySignature,
		hydratedRevisionSignature,
	});

	if (action.kind === "reset") {
		if (hydratedRevisionSignature !== null) {
			hydratedRevisionSignature = null;
		}
		return;
	}
	if (action.kind === "hydrate" && sessionId) {
		hydratedRevisionSignature = action.signature;
		hydrateFromPersistedSessionState(sessionId);
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
				{diffStyle}
				{diffOptions}
			/>
		{/key}
	{/if}
{/snippet}

<div class="flex h-full w-full flex-col overflow-hidden">
	<div class="relative flex min-h-0 flex-1 flex-col overflow-hidden">
		<div class="min-h-0 flex-1 overflow-auto h-0">
			{@render reviewBody()}
		</div>
	</div>
</div>
