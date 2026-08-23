<script lang="ts">
import { HugeiconsIcon } from "@acepe/ui";
import * as Effect from "effect/Effect";
import { SvelteMap, SvelteSet } from "svelte/reactivity";
import { toast } from "svelte-sonner";
import { Button } from "$lib/components/ui/button/index.js";
import { Spinner } from "$lib/components/ui/spinner/index.js";
import { checkpointStore } from "../../store/checkpoint-store.svelte.js";
import { getSessionStore } from "../../store/session-store.svelte.js";
import type { Checkpoint } from "../../types/checkpoint.js";
import CheckpointCard from "./checkpoint-card.svelte";
import { deriveCheckpointUserMessagePreviews } from "./checkpoint-message-preview.js";

interface Props {
	sessionId: string;
	projectPath: string;
	checkpoints?: Checkpoint[];
	isLoading?: boolean;
	onRevertComplete?: () => void;
	onClose?: () => void;
}

let {
	sessionId,
	projectPath,
	checkpoints = [],
	isLoading = false,
	onRevertComplete,
	onClose,
}: Props = $props();

const sessionStore = getSessionStore();

const visibleCheckpoints = $derived(checkpoints.filter((cp) => cp.fileCount > 0));

let revertingCheckpointId = $state<string | null>(null);
let collapsedCheckpointIds = new SvelteSet<string>();

const userMessagePreviews = $derived.by(() => {
	const transcriptEntries = sessionStore.read.getSessionTranscriptEntries(sessionId);
	const previews = deriveCheckpointUserMessagePreviews({
		transcriptEntries,
		checkpoints: visibleCheckpoints,
	});

	return previews === null ? null : new SvelteMap(previews);
});

async function handleRevert(checkpoint: Checkpoint) {
	revertingCheckpointId = checkpoint.id;

	await Effect.runPromise(
		checkpointStore.revertToCheckpoint(sessionId, checkpoint.id, projectPath).pipe(
			Effect.match({
				onSuccess: (revertResult) => {
					if (revertResult.success) {
						toast.success(`Reverted to checkpoint #${checkpoint.checkpointNumber}`);
					} else {
						toast.warning(
							`Partially reverted: ${revertResult.revertedFiles.length} succeeded, ${revertResult.failedFiles.length} failed`
						);
					}
					onRevertComplete?.();
				},
				onFailure: (error) => {
					toast.error(`Failed to revert: ${error.message}`);
				},
			})
		)
	);

	revertingCheckpointId = null;
}

function toggleExpanded(checkpointId: string) {
	const newSet = new SvelteSet(collapsedCheckpointIds);
	if (newSet.has(checkpointId)) {
		newSet.delete(checkpointId);
	} else {
		newSet.add(checkpointId);
	}
	collapsedCheckpointIds = newSet;
}

function isExpanded(checkpointId: string): boolean {
	return !collapsedCheckpointIds.has(checkpointId);
}
</script>

<div class="flex flex-col h-full" data-testid="checkpoint-timeline">
	{#if onClose}
		<div class="flex items-center px-3 py-2">
			<Button
				variant="ghost"
				size="sm"
				class="h-7 gap-1.5 text-muted-foreground hover:text-foreground"
				onclick={onClose}
			>
				<HugeiconsIcon name="arrow-left" class="h-3.5 w-3.5" />
				<span class="text-xs">{"Back"}</span>
			</Button>
		</div>
	{/if}

	<div class="flex-1 overflow-y-auto flex justify-center">
		<div class="w-full max-w-4xl">
			{#if isLoading}
				<div class="flex items-center justify-center h-24 text-muted-foreground text-sm">
					<Spinner class="mr-2" size={16} />
					{"Loading checkpoints..."}
				</div>
			{:else if visibleCheckpoints.length === 0}
				<div class="flex items-center justify-center h-24 text-muted-foreground text-xs">
					{"No checkpoints yet"}
				</div>
			{:else}
				<div class="p-2 space-y-1">
					{#each Array.from(visibleCheckpoints).reverse() as checkpoint (checkpoint.id)}
						<CheckpointCard
							{checkpoint}
							{projectPath}
							userMessagePreview={userMessagePreviews?.get(checkpoint.id) ?? null}
							isExpanded={isExpanded(checkpoint.id)}
							fileSnapshots={checkpoint.files ?? []}
							isLoadingFiles={false}
							isReverting={revertingCheckpointId === checkpoint.id}
							onToggleExpand={() => toggleExpanded(checkpoint.id)}
							onRevert={() => handleRevert(checkpoint)}
						/>
					{/each}
				</div>
			{/if}
		</div>
	</div>
</div>
