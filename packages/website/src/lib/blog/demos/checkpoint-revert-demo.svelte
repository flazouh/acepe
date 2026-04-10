<script lang="ts">
/**
 * Demo: Checkpoint Revert
 * Shows the real revert flow using CheckpointCard: hover → revert button → confirm → done.
 */
import {
	CheckpointCard,
	FilePathBadge,
	type CheckpointData,
	type CheckpointFile,
	type FileRowState,
} from "@acepe/ui";
import { SvelteMap } from "svelte/reactivity";

const ICON_BASE_PATH = "/svgs/icons";

const checkpoint: CheckpointData = {
	id: "revert-cp",
	number: 3,
	message: "Refactor payment validation",
	timestamp: Date.now() - 10 * 60 * 1000,
	fileCount: 3,
	totalInsertions: 78,
	totalDeletions: 34,
	isAuto: true,
};

const files: CheckpointFile[] = [
	{ id: "rv-1", filePath: "src/lib/payment/service.ts", linesAdded: 42, linesRemoved: 28 },
	{ id: "rv-2", filePath: "src/lib/payment/validation.ts", linesAdded: 24, linesRemoved: 6 },
	{ id: "rv-3", filePath: "src/lib/payment/types.ts", linesAdded: 12, linesRemoved: 0 },
];

let isExpanded = $state(true);
let isConfirming = $state(false);
let isReverting = $state(false);
let fileStates = $state(new SvelteMap<string, FileRowState>());

function handleRevertClick() {
	isConfirming = true;
}

function handleRevertConfirm() {
	isConfirming = false;
	isReverting = true;

	setTimeout(() => {
		isReverting = false;
	}, 1200);
}

function handleRevertCancel() {
	isConfirming = false;
}
</script>

<div class="demo-container">
	<p class="demo-hint">
		Click "Revert" on the checkpoint header or on any file to see the confirmation flow.
	</p>

	<div class="card-wrapper">
		<CheckpointCard
			{checkpoint}
			{files}
			{fileStates}
			{isExpanded}
			{isConfirming}
			{isReverting}
			showRevertButton={true}
			alwaysShowRevert={true}
			fileRevertLabel="Revert"
			allowFileDiffExpand={false}
			onToggleExpand={() => (isExpanded = !isExpanded)}
			onRevertClick={handleRevertClick}
			onRevertConfirm={handleRevertConfirm}
			onRevertCancel={handleRevertCancel}
		>
			{#snippet fileDisplay({ file })}
				<FilePathBadge
					filePath={file.filePath}
					iconBasePath={ICON_BASE_PATH}
					linesAdded={file.linesAdded ?? 0}
					linesRemoved={file.linesRemoved ?? 0}
					interactive={false}
				/>
			{/snippet}
		</CheckpointCard>
	</div>
</div>

<style>
	.demo-container {
		max-width: 700px;
		margin: 2rem auto;
		padding: 1.5rem;
		border-radius: 0.5rem;
		border: 1px solid hsl(var(--border) / 0.5);
		background: hsl(var(--card) / 0.3);
	}

	.demo-hint {
		margin-bottom: 1rem;
		padding: 0.75rem;
		border-radius: 0.375rem;
		background: hsl(var(--muted) / 0.5);
		color: hsl(var(--muted-foreground));
		font-size: 0.875rem;
		text-align: center;
	}

	.card-wrapper {
		max-width: 100%;
	}
</style>
