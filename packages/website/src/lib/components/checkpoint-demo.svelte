<script lang="ts">
/**
 * Checkpoint demo for the homepage features section.
 * Shows a timeline of auto-saved checkpoints with expand, collapse, and revert.
 */
import {
	CheckpointTimeline,
	FilePathBadge,
	type CheckpointData,
	type CheckpointFile,
	type CheckpointState,
	type FileRowState,
} from "@acepe/ui";
import { SvelteMap } from "svelte/reactivity";

const ICON_BASE_PATH = "/svgs/icons";

const checkpoints: CheckpointData[] = [
	{
		id: "cp3",
		number: 3,
		message: "Add order confirmation email",
		timestamp: Date.now() - 3 * 60 * 1000,
		fileCount: 3,
		totalInsertions: 89,
		totalDeletions: 4,
		isAuto: true,
	},
	{
		id: "cp2",
		number: 2,
		message: "Integrate Stripe payment flow",
		timestamp: Date.now() - 12 * 60 * 1000,
		fileCount: 4,
		totalInsertions: 156,
		totalDeletions: 22,
		isAuto: true,
	},
	{
		id: "cp1",
		number: 1,
		message: "Add cart and checkout pages",
		timestamp: Date.now() - 28 * 60 * 1000,
		fileCount: 5,
		totalInsertions: 234,
		totalDeletions: 0,
		isAuto: true,
	},
];

const checkpointFiles: Record<string, CheckpointFile[]> = {
	cp3: [
		{
			id: "f3-1",
			filePath: "src/lib/email/order-confirmation.ts",
			linesAdded: 67,
			linesRemoved: 0,
		},
		{ id: "f3-2", filePath: "src/lib/email/templates/order.html", linesAdded: 18, linesRemoved: 4 },
		{
			id: "f3-3",
			filePath: "src/routes/checkout/+page.server.ts",
			linesAdded: 4,
			linesRemoved: 0,
		},
	],
	cp2: [
		{ id: "f2-1", filePath: "src/lib/stripe/client.ts", linesAdded: 78, linesRemoved: 0 },
		{ id: "f2-2", filePath: "src/lib/stripe/webhooks.ts", linesAdded: 45, linesRemoved: 12 },
		{
			id: "f2-3",
			filePath: "src/routes/checkout/+page.svelte",
			linesAdded: 23,
			linesRemoved: 8,
		},
		{
			id: "f2-4",
			filePath: "src/routes/checkout/+page.server.ts",
			linesAdded: 10,
			linesRemoved: 2,
		},
	],
	cp1: [
		{ id: "f1-1", filePath: "src/lib/cart/store.ts", linesAdded: 89, linesRemoved: 0 },
		{ id: "f1-2", filePath: "src/lib/cart/types.ts", linesAdded: 34, linesRemoved: 0 },
		{ id: "f1-3", filePath: "src/routes/cart/+page.svelte", linesAdded: 67, linesRemoved: 0 },
		{
			id: "f1-4",
			filePath: "src/routes/checkout/+page.svelte",
			linesAdded: 42,
			linesRemoved: 0,
		},
		{
			id: "f1-5",
			filePath: "src/routes/checkout/+page.server.ts",
			linesAdded: 2,
			linesRemoved: 0,
		},
	],
};

let checkpointStates = $state(new SvelteMap<string, CheckpointState>());
let fileStates = $state(new SvelteMap<string, FileRowState>());

$effect(() => {
	for (const cp of checkpoints) {
		if (!checkpointStates.has(cp.id)) {
			checkpointStates.set(cp.id, {
				isExpanded: true,
				isLoadingFiles: false,
				isReverting: false,
				files: checkpointFiles[cp.id] ?? [],
			});
		}
	}
});

function handleToggleCheckpoint(checkpointId: string) {
	const current = checkpointStates.get(checkpointId);
	if (current) {
		checkpointStates.set(checkpointId, { ...current, isExpanded: !current.isExpanded });
	}
}

function handleRevertConfirm(checkpointId: string) {
	const current = checkpointStates.get(checkpointId);
	if (!current) return;
	checkpointStates.set(checkpointId, { ...current, isReverting: true });
	setTimeout(() => {
		checkpointStates.set(checkpointId, { ...current, isReverting: false });
	}, 1200);
}
</script>

<CheckpointTimeline
	{checkpoints}
	{checkpointStates}
	{fileStates}
	showRevertButtons={true}
	fileRevertLabel="Revert"
	allowFileDiffExpand={false}
	onToggleCheckpoint={handleToggleCheckpoint}
	onRevertConfirm={handleRevertConfirm}
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
</CheckpointTimeline>
