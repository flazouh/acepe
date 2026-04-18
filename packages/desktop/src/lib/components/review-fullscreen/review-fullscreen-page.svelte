<script lang="ts">
import { IconX } from "@tabler/icons-svelte";
import AgentPanelReviewContent from "$lib/acp/components/agent-panel/components/agent-panel-review-content.svelte";
import { aggregateFileEdits } from "$lib/acp/components/modified-files/logic/aggregate-file-edits.js";
import { getSessionStore } from "$lib/acp/store/session-store.svelte.js";
import { Button } from "$lib/components/ui/button/index.js";
interface Props {
	sessionId: string;
	fileIndex: number;
	onClose: () => void;
	onFileIndexChange: (index: number) => void;
}

let { sessionId, fileIndex, onClose, onFileIndexChange }: Props = $props();

const sessionStore = getSessionStore();
const entries = $derived(sessionStore.getEntries(sessionId));
const identity = $derived(sessionStore.getSessionIdentity(sessionId));
const modifiedFilesState = $derived.by(() => aggregateFileEdits(entries));
const projectPath = $derived(identity?.projectPath ?? null);

const hasModifications = $derived(modifiedFilesState.fileCount > 0);
const isValidIndex = $derived(fileIndex >= 0 && fileIndex < modifiedFilesState.files.length);
const effectiveFileIndex = $derived(
	isValidIndex ? fileIndex : Math.max(0, Math.min(fileIndex, modifiedFilesState.files.length - 1))
);

function handleFileIndexChange(index: number): void {
	onFileIndexChange(index);
}
</script>

<div class="flex flex-col h-full bg-background">
	<!-- Header with close button - add top padding for macOS title bar -->
	<div
		class="flex items-center justify-between px-4 py-2 pt-[46px] border-b border-border shrink-0"
	>
		<h1 class="text-lg font-medium">{"Review Changes"}</h1>
		<Button variant="ghost" size="icon" onclick={onClose} aria-label={"Close"}>
			<IconX class="h-5 w-5" />
		</Button>
	</div>

	{#if !identity}
		<div class="flex-1 flex items-center justify-center text-muted-foreground">
			{"Loading..."}
		</div>
	{:else if !hasModifications}
		<div class="flex-1 flex items-center justify-center text-muted-foreground px-4">
			{`${0} files changed`} – {"Close"}
		</div>
	{:else}
		<div class="flex-1 flex flex-col min-h-0 overflow-hidden">
			<AgentPanelReviewContent
				{modifiedFilesState}
				selectedFileIndex={effectiveFileIndex}
				{sessionId}
				{projectPath}
				{onClose}
				onFileIndexChange={handleFileIndexChange}
			/>
		</div>
	{/if}
</div>
