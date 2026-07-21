<script lang="ts">
/**
 * Desktop wrapper for CheckpointCard.
 * Handles store integration and Tauri commands, delegates rendering to @acepe/ui.
 */
import { CheckpointCard as BaseCheckpointCard, FilePathBadge, type FileRowState } from "@acepe/ui";
import { SvelteMap } from "svelte/reactivity";
import { checkpointStore } from "../../store/checkpoint-store.svelte.js";
import type { Checkpoint, FileSnapshot } from "../../types/checkpoint.js";
import {
	buildCheckpointCardData,
	buildCheckpointDiffLoadedState,
	buildCheckpointDiffLoadFailedState,
	buildCheckpointDiffLoadingState,
	buildCheckpointDiffToggleState,
	buildCheckpointFileRevertState,
	buildCheckpointFiles,
	getCheckpointFileName,
} from "./checkpoint-card-state.js";
import CheckpointDiffPreview from "./checkpoint-diff-preview.svelte";

interface Props {
	/** The checkpoint data */
	checkpoint: Checkpoint;
	/** Project path passed to child CheckpointFileList for file operations */
	projectPath: string;
	/** Preview of the user message that triggered this checkpoint (computed by parent) */
	userMessagePreview: string | null;
	/** Whether this card is expanded */
	isExpanded: boolean;
	/** File snapshots for this checkpoint (loaded when expanded) */
	fileSnapshots: FileSnapshot[];
	/** Whether file snapshots are loading */
	isLoadingFiles: boolean;
	/** Whether a revert is in progress */
	isReverting: boolean;
	/** Called when expand/collapse is toggled */
	onToggleExpand: () => void;
	/** Called when revert is requested */
	onRevert: () => void;
}

let {
	checkpoint,
	projectPath,
	userMessagePreview,
	isExpanded,
	fileSnapshots,
	isLoadingFiles,
	isReverting,
	onToggleExpand,
	onRevert,
}: Props = $props();

// Local confirmation state
let isConfirming = $state(false);

// File-level state for reverts and diff expansion
let fileStates = new SvelteMap<string, FileRowState>();

const checkpointData = $derived(
	buildCheckpointCardData({
		checkpoint,
		userMessagePreview,
	})
);
const files = $derived(buildCheckpointFiles(fileSnapshots));

function handleRevertClick() {
	if (isReverting) return;
	isConfirming = true;
}

function handleRevertConfirm() {
	isConfirming = false;
	onRevert();
}

function handleRevertCancel() {
	isConfirming = false;
}

async function handleRevertFile(fileId: string, filePath: string) {
	const currentState = fileStates.get(fileId);
	fileStates.set(fileId, buildCheckpointFileRevertState(currentState, true));

	const result = await checkpointStore.revertFile(
		checkpoint.sessionId,
		checkpoint.id,
		filePath,
		projectPath
	);

	result.match(
		() => {
			// Success - clear reverting state
		},
		() => {
			// Error - will be handled by store
		}
	);

	fileStates.set(fileId, buildCheckpointFileRevertState(currentState, false));
}

async function handleToggleFileDiff(fileId: string) {
	const current = fileStates.get(fileId);
	const newExpanded = !current?.isDiffExpanded;

	if (newExpanded && !current?.diff) {
		// Load the file diff content (old + new) from checkpoint
		fileStates.set(fileId, buildCheckpointDiffLoadingState());

		// Get the file snapshot to find the file path
		const fileSnapshot = fileSnapshots.find((f) => f.id === fileId);
		if (fileSnapshot) {
			const result = await checkpointStore.getFileDiffContentAtCheckpoint(
				checkpoint.sessionId,
				checkpoint.id,
				fileSnapshot.filePath
			);

			result.match(
				({ oldContent, newContent }) => {
					fileStates.set(
						fileId,
						buildCheckpointDiffLoadedState({
							filePath: fileSnapshot.filePath,
							oldContent,
							newContent,
						})
					);
				},
				() => {
					fileStates.set(fileId, buildCheckpointDiffLoadFailedState());
				}
			);
		}
	} else {
		fileStates.set(
			fileId,
			buildCheckpointDiffToggleState({
				currentState: current,
				isDiffExpanded: newExpanded,
			})
		);
	}
}
</script>

<BaseCheckpointCard
	checkpoint={checkpointData}
	{files}
	{fileStates}
	{isExpanded}
	{isLoadingFiles}
	{isReverting}
	{isConfirming}
	showRevertButton={true}
	alwaysShowRevert={true}
	allowFileDiffExpand={true}
	revertLabel={"Revert"}
	fileRevertLabel={"Revert"}
	cancelLabel={"Cancel"}
	confirmLabel={"Confirm"}
	loadingFilesMessage={"Loading files..."}
	{onToggleExpand}
	onRevertClick={handleRevertClick}
	onRevertConfirm={handleRevertConfirm}
	onRevertCancel={handleRevertCancel}
	onToggleFileDiff={handleToggleFileDiff}
	onRevertFile={handleRevertFile}
>
	{#snippet fileDisplay({ file })}
		<FilePathBadge
			filePath={file.filePath}
			fileName={getCheckpointFileName(file.filePath)}
			linesAdded={file.linesAdded ?? 0}
			linesRemoved={file.linesRemoved ?? 0}
			interactive={false}
		/>
	{/snippet}
	{#snippet diffContent({ diff })}
		<CheckpointDiffPreview {diff} />
	{/snippet}
</BaseCheckpointCard>
