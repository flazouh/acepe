<script lang="ts">
import { ReviewWorkspace, resolveReviewWorkspaceSelectedIndex } from "@acepe/ui/agent-panel";

import type { ModifiedFilesState } from "../../../types/modified-files-state.js";
import type { ReviewDiffDensity } from "../../modified-files/components/review-diff-view-state.svelte.js";
import AgentPanelReviewContent from "./agent-panel-review-content.svelte";
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
	diffDensity?: ReviewDiffDensity;
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
	diffDensity = "default",
}: Props = $props();

const reviewWorkspaceFiles = $derived.by(() =>
	buildReviewWorkspaceFilesFromSessionState(reviewFilesState, sessionId)
);

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

let keepCurrentFileAction = $state<(() => void) | null>(null);
let keepCurrentFileDisabled = $state(true);

function handleKeepActionChange(action: (() => void) | null, disabled: boolean): void {
	keepCurrentFileAction = action;
	keepCurrentFileDisabled = disabled;
}

function handleWorkspaceFileSelect(displayIndex: number): void {
	const selectedFile = reviewWorkspaceFiles[displayIndex];
	onFileIndexChange(selectedFile?.sourceIndex ?? displayIndex);
}
</script>

<ReviewWorkspace
	files={reviewWorkspaceFiles}
	selectedFileIndex={reviewWorkspaceSelectedIndex}
	{onClose}
	onFileSelect={handleWorkspaceFileSelect}
	headerLabel={"Review Changes"}
	closeButtonLabel={"Back"}
	emptyStateLabel={REVIEW_WORKSPACE_EMPTY_STATE_LABEL}
	onKeepFile={showHeader ? (keepCurrentFileAction ?? undefined) : undefined}
	keepFileDisabled={showHeader ? keepCurrentFileDisabled : true}
	{showHeader}
	{showCloseButton}
	{compact}
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
			onKeepActionChange={showHeader ? handleKeepActionChange : undefined}
		/>
	{/snippet}
</ReviewWorkspace>
