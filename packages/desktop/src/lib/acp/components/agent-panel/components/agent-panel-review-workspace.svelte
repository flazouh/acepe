<script lang="ts">
import { ReviewWorkspace, resolveReviewWorkspaceSelectedIndex } from "@acepe/ui/agent-panel";
import { toast } from "svelte-sonner";
import { tauriClient } from "$lib/utils/tauri-client.js";

import type { ModifiedFilesState } from "../../../types/modified-files-state.js";
import type { ReviewDiffDensity } from "../../modified-files/components/review-diff-view-state.svelte.js";
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
	diffDensity?: ReviewDiffDensity;
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
	diffDensity = "default",
	hideBottomWidget = false,
	onControlsChange,
}: Props = $props();

const reviewWorkspaceFiles = $derived.by(() =>
	buildReviewWorkspaceFilesFromSessionState(reviewFilesState, sessionId)
);

function handleFileRevert(displayIndex: number): void {
	const file = reviewWorkspaceFiles[displayIndex];
	if (!file || !projectPath) {
		toast.error("Cannot revert: no project path");
		return;
	}
	tauriClient.git.discardChanges(projectPath, [file.filePath]).match(
		() => toast.success(`Discarded changes in ${file.fileName ?? file.filePath.split("/").pop()}`),
		(err) => toast.error(`Failed to discard: ${err.message}`)
	);
}

const reviewWorkspaceSelectedIndex = $derived.by(() => {
	const displayIndex = reviewWorkspaceFiles.findIndex((file) => file.sourceIndex === selectedFileIndex);
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
</script>

<div class="flex h-full min-h-0 flex-1 flex-col">
<ReviewWorkspace
	files={reviewWorkspaceFiles}
	selectedFileIndex={reviewWorkspaceSelectedIndex}
	{onClose}
	onFileSelect={handleWorkspaceFileSelect}
	onFileRevert={handleFileRevert}
	headerLabel={"Review Changes"}
	closeButtonLabel={"Back"}
	emptyStateLabel={REVIEW_WORKSPACE_EMPTY_STATE_LABEL}
	{showHeader}
	{showCloseButton}
	{compact}
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
			{onClose}
			{onFileIndexChange}
			{onControlsChange}
			{hideBottomWidget}
		/>
	{/snippet}
</ReviewWorkspace>
</div>
