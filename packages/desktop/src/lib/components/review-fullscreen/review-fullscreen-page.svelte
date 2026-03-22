<script lang="ts">
import IconX from "@tabler/icons-svelte/icons/x";
import AgentPanelReviewContent from "$lib/acp/components/agent-panel/components/agent-panel-review-content.svelte";
import { aggregateFileEdits } from "$lib/acp/components/modified-files/logic/aggregate-file-edits.js";
import { getSessionStore } from "$lib/acp/store/session-store.svelte.js";
import { Button } from "$lib/components/ui/button/index.js";
import * as m from "$lib/paraglide/messages.js";

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
	isValidIndex ? fileIndex : Math.min(fileIndex, Math.max(0, modifiedFilesState.files.length - 1))
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
		<h1 class="text-lg font-medium">{m.modified_files_review_title()}</h1>
		<Button variant="ghost" size="icon" onclick={onClose} aria-label={m.common_close()}>
			<IconX class="h-5 w-5" />
		</Button>
	</div>

	{#if !identity}
		<div class="flex-1 flex items-center justify-center text-muted-foreground">
			{m.common_loading()}
		</div>
	{:else if !hasModifications}
		<div class="flex-1 flex items-center justify-center text-muted-foreground px-4">
			{m.modified_files_count({ count: 0 })} – {m.common_close()}
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
