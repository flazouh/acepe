<script lang="ts">
/**
 * Desktop wrapper for CheckpointCard.
 * Handles store integration and Tauri commands, delegates rendering to @acepe/ui.
 */
import {
	CheckpointCard as BaseCheckpointCard,
	type CheckpointData,
	FilePathBadge,
	type FileRowState,
	type CheckpointFile as UICheckpointFile,
} from "@acepe/ui";
import { SvelteMap } from "svelte/reactivity";
import * as m from "$lib/messages.js";
import { checkpointStore } from "../../store/checkpoint-store.svelte.js";
import type { Checkpoint, FileSnapshot } from "../../types/checkpoint.js";
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

// Convert Checkpoint to CheckpointData for the UI component
const checkpointData: CheckpointData = $derived({
	id: checkpoint.id,
	number: checkpoint.checkpointNumber,
	message: userMessagePreview,
	timestamp: checkpoint.createdAt,
	fileCount: checkpoint.fileCount,
	totalInsertions: checkpoint.totalLinesAdded,
	totalDeletions: checkpoint.totalLinesRemoved,
	isAuto: checkpoint.isAuto,
});

// Convert FileSnapshot[] to CheckpointFile[] for the UI component
const files: UICheckpointFile[] = $derived(
	fileSnapshots
		.filter((f) => (f.linesAdded ?? 0) > 0 || (f.linesRemoved ?? 0) > 0)
		.map((f) => ({
			id: f.id,
			filePath: f.filePath,
			linesAdded: f.linesAdded,
			linesRemoved: f.linesRemoved,
			fileSize: f.fileSize,
		}))
);

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
	fileStates.set(fileId, {
		...(currentState ?? { isDiffExpanded: false, isLoadingDiff: false, diff: null }),
		isReverting: true,
	});

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

	fileStates.set(fileId, {
		...(currentState ?? { isDiffExpanded: false, isLoadingDiff: false, diff: null }),
		isReverting: false,
	});
}

async function handleToggleFileDiff(fileId: string) {
	const current = fileStates.get(fileId);
	const newExpanded = !current?.isDiffExpanded;

	if (newExpanded && !current?.diff) {
		// Load the file diff content (old + new) from checkpoint
		fileStates.set(fileId, {
			isDiffExpanded: true,
			isLoadingDiff: true,
			isReverting: false,
			diff: null,
		});

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
					fileStates.set(fileId, {
						isDiffExpanded: true,
						isLoadingDiff: false,
						isReverting: false,
						diff: {
							filePath: fileSnapshot.filePath,
							content: newContent,
							oldContent,
							language: getLanguageFromPath(fileSnapshot.filePath),
						},
					});
				},
				() => {
					fileStates.set(fileId, {
						isDiffExpanded: true,
						isLoadingDiff: false,
						isReverting: false,
						diff: null,
					});
				}
			);
		}
	} else {
		fileStates.set(fileId, {
			isDiffExpanded: newExpanded,
			isLoadingDiff: false,
			isReverting: current?.isReverting ?? false,
			diff: current?.diff ?? null,
		});
	}
}

function getLanguageFromPath(filePath: string): string {
	const ext = filePath.split(".").pop()?.toLowerCase();
	const langMap: Record<string, string> = {
		ts: "typescript",
		tsx: "typescript",
		js: "javascript",
		jsx: "javascript",
		svelte: "svelte",
		rs: "rust",
		py: "python",
		json: "json",
		md: "markdown",
		css: "css",
		html: "html",
	};
	return langMap[ext ?? ""] ?? "text";
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
	revertLabel={m.checkpoint_revert_button()}
	fileRevertLabel={m.checkpoint_revert_button()}
	cancelLabel={m.common_cancel()}
	confirmLabel={m.common_confirm()}
	loadingFilesMessage={m.checkpoint_loading_files()}
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
			fileName={file.filePath.split("/").pop() ?? file.filePath}
			linesAdded={file.linesAdded ?? 0}
			linesRemoved={file.linesRemoved ?? 0}
			interactive={false}
		/>
	{/snippet}
	{#snippet diffContent({ diff })}
		<CheckpointDiffPreview {diff} />
	{/snippet}
</BaseCheckpointCard>
