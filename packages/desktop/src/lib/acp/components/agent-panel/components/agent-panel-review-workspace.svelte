<script lang="ts">
import {
	ReviewWorkspace,
	resolveReviewWorkspaceSelectedIndex,
	type ReviewWorkspaceFileItem,
	type ReviewWorkspaceFileResetStatus,
} from "@acepe/ui/agent-panel";
import { SvelteMap } from "svelte/reactivity";
import { toast } from "svelte-sonner";
import { tauriClient } from "$lib/utils/tauri-client.js";

import type { ModifiedFilesState } from "../../../types/modified-files-state.js";
import type {
	DiffViewStyle,
	ReviewDiffDensity,
	ReviewDiffOptions,
} from "../../modified-files/components/review-diff-view-state.svelte.js";
import AgentPanelReviewContent from "./agent-panel-review-content.svelte";
import type { ReviewControlsSnapshot } from "./agent-panel-review-content-types.js";
import { buildReviewWorkspaceFilesFromSessionState } from "./review-workspace-model.js";

const REVIEW_WORKSPACE_EMPTY_STATE_LABEL = "Nothing to review";

interface Props {
	reviewFilesState: ModifiedFilesState;
	selectedFileIndex: number;
	sessionId?: string | null;
	projectPath?: string | null;
	isActive?: boolean;
	onClose: () => void;
	onFileIndexChange: (index: number) => void;
	showHeader?: boolean;
	showCloseButton?: boolean;
	compact?: boolean;
	flat?: boolean;
	fileListVariant?: "tree" | "flat";
	diffDensity?: ReviewDiffDensity;
	diffStyle?: DiffViewStyle;
	diffOptions?: ReviewDiffOptions;
	hideBottomWidget?: boolean;
	onControlsChange?: (controls: ReviewControlsSnapshot | null) => void;
}

let {
	reviewFilesState,
	selectedFileIndex,
	sessionId = null,
	projectPath = null,
	isActive = true,
	onClose,
	onFileIndexChange,
	showHeader = true,
	showCloseButton = true,
	compact = false,
	flat = false,
	fileListVariant = "tree",
	diffDensity = "default",
	diffStyle = "unified",
	diffOptions,
	hideBottomWidget = false,
	onControlsChange,
}: Props = $props();

interface FileResetState {
	status: ReviewWorkspaceFileResetStatus;
	label: string | null;
}

let fileResetStates = new SvelteMap<string, FileResetState>();

const reviewWorkspaceFiles = $derived.by(() => {
	const files = buildReviewWorkspaceFilesFromSessionState(reviewFilesState, sessionId);

	return files.map<ReviewWorkspaceFileItem>((file) => {
		const resetState = fileResetStates.get(file.filePath);
		return {
			id: file.id,
			filePath: file.filePath,
			fileName: file.fileName,
			sourceIndex: file.sourceIndex,
			reviewStatus: file.reviewStatus,
			resetStatus: resetState?.status ?? "idle",
			resetStatusLabel: resetState?.label ?? null,
			additions: file.additions,
			deletions: file.deletions,
			onSelect: file.onSelect,
			onRevert: file.onRevert,
		};
	});
});

function setFileResetState(
	filePath: string,
	status: ReviewWorkspaceFileResetStatus,
	label: string | null
): void {
	fileResetStates.set(filePath, { status, label });
}

function handleFileRevert(displayIndex: number): void {
	const file = reviewWorkspaceFiles[displayIndex];
	if (!file || !projectPath) {
		toast.error("Cannot revert: no project path");
		return;
	}

	const currentStatus = file.resetStatus ?? "idle";
	if (currentStatus !== "confirming" && currentStatus !== "failed") {
		setFileResetState(file.filePath, "confirming", "Reset this file?");
		return;
	}

	const capturedFile: ReviewWorkspaceFileItem = file;
	setFileResetState(capturedFile.filePath, "resetting", "Resetting");
	tauriClient.git.discardChanges(projectPath, [capturedFile.filePath]).match(
		() => {
			setFileResetState(capturedFile.filePath, "reset", "Reset");
			toast.success(
				`Discarded changes in ${capturedFile.fileName ?? capturedFile.filePath.split("/").pop()}`
			);
		},
		(err) => {
			setFileResetState(capturedFile.filePath, "failed", "Reset failed");
			toast.error(`Failed to discard: ${err.message}`);
		}
	);
}

function handleFileRevertCancel(displayIndex: number): void {
	const file = reviewWorkspaceFiles[displayIndex];
	if (!file) {
		return;
	}

	fileResetStates.delete(file.filePath);
}

const reviewWorkspaceSelectedIndex = $derived.by(() => {
	const displayIndex = reviewWorkspaceFiles.findIndex(
		(file) => file.sourceIndex === selectedFileIndex
	);
	if (displayIndex >= 0) {
		return displayIndex;
	}

	return resolveReviewWorkspaceSelectedIndex(reviewWorkspaceFiles, null);
});

const selectedSourceFileIndex = $derived.by(() => {
	if (reviewWorkspaceSelectedIndex === null) {
		return selectedFileIndex;
	}

	const selectedFile = reviewWorkspaceFiles[reviewWorkspaceSelectedIndex];
	return selectedFile?.sourceIndex ?? reviewWorkspaceSelectedIndex;
});

function handleWorkspaceFileSelect(displayIndex: number): void {
	const selectedFile = reviewWorkspaceFiles[displayIndex];
	onFileIndexChange(selectedFile?.sourceIndex ?? displayIndex);
}

function handleSelectedFileRevert(): void {
	if (reviewWorkspaceSelectedIndex === null) {
		return;
	}

	handleFileRevert(reviewWorkspaceSelectedIndex);
}

function handleContentControlsChange(controls: ReviewControlsSnapshot | null): void {
	if (!onControlsChange) {
		return;
	}

	if (controls === null) {
		onControlsChange(null);
		return;
	}

	onControlsChange({
		fileCurrent: controls.fileCurrent,
		fileTotal: controls.fileTotal,
		isReviewed: controls.isReviewed,
		onToggleReviewed: controls.onToggleReviewed,
		onRevertFile: handleSelectedFileRevert,
		hasPrevFile: controls.hasPrevFile,
		hasNextFile: controls.hasNextFile,
		onPrevFile: controls.onPrevFile,
		onNextFile: controls.onNextFile,
	});
}
</script>

<div class="flex h-full min-h-0 flex-1 flex-col">
<ReviewWorkspace
	files={reviewWorkspaceFiles}
	selectedFileIndex={reviewWorkspaceSelectedIndex}
	{onClose}
	onFileSelect={handleWorkspaceFileSelect}
	onFileRevert={handleFileRevert}
	onFileRevertCancel={handleFileRevertCancel}
	headerLabel={"Review Changes"}
	closeButtonLabel={"Back"}
	emptyStateLabel={REVIEW_WORKSPACE_EMPTY_STATE_LABEL}
	{showHeader}
	{showCloseButton}
	{compact}
	{fileListVariant}
	{flat}
>
	{#snippet content()}
		<AgentPanelReviewContent
			modifiedFilesState={reviewFilesState}
			selectedFileIndex={selectedSourceFileIndex}
			{sessionId}
			{projectPath}
			{isActive}
			{diffDensity}
			{diffStyle}
			{diffOptions}
			{onClose}
			{onFileIndexChange}
			onControlsChange={handleContentControlsChange}
			{hideBottomWidget}
		/>
	{/snippet}
</ReviewWorkspace>
</div>
