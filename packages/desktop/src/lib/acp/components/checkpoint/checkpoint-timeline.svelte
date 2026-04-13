<script lang="ts">
import { ArrowLeft } from "phosphor-svelte";
import { SvelteMap, SvelteSet } from "svelte/reactivity";
import { toast } from "svelte-sonner";
import { Button } from "$lib/components/ui/button/index.js";
import { Spinner } from "$lib/components/ui/spinner/index.js";
import * as m from "$lib/messages.js";
import { checkpointStore } from "../../store/checkpoint-store.svelte.js";
import { getSessionStore } from "../../store/session-store.svelte.js";
import type { SessionEntry } from "../../store/types.js";
import type { Checkpoint, FileSnapshot } from "../../types/checkpoint.js";
import CheckpointCard from "./checkpoint-card.svelte";

/** Maximum characters for user message preview */
const MAX_PREVIEW_LENGTH = 50;

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

// Filter out checkpoints with no modified files
const visibleCheckpoints = $derived(checkpoints.filter((cp) => cp.fileCount > 0));

let revertingCheckpointId = $state<string | null>(null);
// All checkpoints expanded by default - track which ones are collapsed
let collapsedCheckpointIds = new SvelteSet<string>();
// Use SvelteMap for granular reactivity without full Map recreation
let fileSnapshots = new SvelteMap<string, FileSnapshot[]>();
let loadingFilesForCheckpoint = $state<string | null>(null);

// Clear local state when session changes to prevent memory leaks
$effect(() => {
	// Track sessionId - when it changes, reset local state
	void sessionId;
	return () => {
		fileSnapshots.clear();
		collapsedCheckpointIds = new SvelteSet();
		loadingFilesForCheckpoint = null;
	};
});

// Load file snapshots for all visible checkpoints on mount (since expanded by default)
$effect(() => {
	for (const checkpoint of visibleCheckpoints) {
		if (!fileSnapshots.has(checkpoint.id) && !collapsedCheckpointIds.has(checkpoint.id)) {
			loadFilesForCheckpoint(checkpoint.id);
		}
	}
});

async function loadFilesForCheckpoint(checkpointId: string) {
	if (fileSnapshots.has(checkpointId)) return;

	loadingFilesForCheckpoint = checkpointId;
	const result = await checkpointStore.getFileSnapshotsForCheckpoint(sessionId, checkpointId);
	result.match(
		(snapshots) => fileSnapshots.set(checkpointId, snapshots),
		(error) => toast.error(m.checkpoint_load_files_failed({ error: error.message }))
	);
	loadingFilesForCheckpoint = null;
}

/**
 * Extract text preview from a user entry's content.
 * Returns null if content is not text or is empty.
 */
function extractTextPreview(entry: SessionEntry & { type: "user" }): string | null {
	const content = entry.message.content;
	if (content.type !== "text") return null;

	const text = content.text.trim();
	if (text.length === 0) return null;

	return text.length > MAX_PREVIEW_LENGTH ? `${text.substring(0, MAX_PREVIEW_LENGTH)}…` : text;
}

/**
 * Compute user message previews for all checkpoints in a single pass.
 * This is more efficient than computing per-card because:
 * 1. We only iterate entries once (O(n)) instead of per checkpoint (O(n*m))
 * 2. Reactive updates only trigger one recomputation, not m recomputations
 */
const userMessagePreviews = $derived.by(() => {
	const entries = sessionStore.getEntries(sessionId);
	const previews = new SvelteMap<string, string | null>();

	if (visibleCheckpoints.length === 0) return previews;

	// Filter to user entries only (typically small subset)
	const userEntries = entries.filter(
		(e): e is SessionEntry & { type: "user" } => e.type === "user"
	);

	// For each checkpoint, find the last user entry before its creation time
	for (const checkpoint of visibleCheckpoints) {
		const checkpointTime = checkpoint.createdAt;

		// Use findLast for cleaner reverse search
		const lastUserEntry = userEntries.findLast(
			(e) => (e.timestamp?.getTime() ?? 0) <= checkpointTime
		);

		previews.set(checkpoint.id, lastUserEntry ? extractTextPreview(lastUserEntry) : null);
	}

	return previews;
});

async function handleRevert(checkpoint: Checkpoint) {
	revertingCheckpointId = checkpoint.id;

	const result = await checkpointStore.revertToCheckpoint(sessionId, checkpoint.id, projectPath);

	result.match(
		(revertResult) => {
			if (revertResult.success) {
				toast.success(
					m.checkpoint_revert_success({ checkpointNumber: checkpoint.checkpointNumber })
				);
			} else {
				toast.warning(
					m.checkpoint_revert_partial({
						succeeded: revertResult.revertedFiles.length,
						failed: revertResult.failedFiles.length,
					})
				);
			}
			onRevertComplete?.();
		},
		(error) => {
			toast.error(m.checkpoint_revert_failed({ error: error.message }));
		}
	);

	revertingCheckpointId = null;
}

function toggleExpanded(checkpointId: string) {
	const newSet = new SvelteSet(collapsedCheckpointIds);
	if (newSet.has(checkpointId)) {
		newSet.delete(checkpointId);
		// Load files when expanding
		loadFilesForCheckpoint(checkpointId);
	} else {
		newSet.add(checkpointId);
	}
	collapsedCheckpointIds = newSet;
}

function isExpanded(checkpointId: string): boolean {
	return !collapsedCheckpointIds.has(checkpointId);
}
</script>

<div class="flex flex-col h-full">
	<!-- Header - back button -->
	{#if onClose}
		<div class="flex items-center px-3 py-2">
			<Button
				variant="ghost"
				size="sm"
				class="h-7 gap-1.5 text-muted-foreground hover:text-foreground"
				onclick={onClose}
			>
				<ArrowLeft class="h-3.5 w-3.5" weight="bold" />
				<span class="text-xs">{m.common_back()}</span>
			</Button>
		</div>
	{/if}

	<!-- Content - scrollable list, centered like main content -->
	<div class="flex-1 overflow-y-auto flex justify-center">
		<div class="w-full max-w-4xl">
			{#if isLoading}
				<div class="flex items-center justify-center h-24 text-muted-foreground text-sm">
					<Spinner class="h-4 w-4 mr-2" />
					{m.checkpoint_loading()}
				</div>
			{:else if visibleCheckpoints.length === 0}
				<div class="flex items-center justify-center h-24 text-muted-foreground text-xs">
					{m.checkpoint_empty_state()}
				</div>
			{:else}
				<!-- Simple list with gap - reversed so oldest (first) is at top -->
				<div class="p-2 space-y-1">
					{#each [...visibleCheckpoints].reverse() as checkpoint (checkpoint.id)}
						<CheckpointCard
							{checkpoint}
							{projectPath}
							userMessagePreview={userMessagePreviews.get(checkpoint.id) ?? null}
							isExpanded={isExpanded(checkpoint.id)}
							fileSnapshots={fileSnapshots.get(checkpoint.id) ?? []}
							isLoadingFiles={loadingFilesForCheckpoint === checkpoint.id}
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
