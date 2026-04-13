<script lang="ts">
import { FilePathBadge } from "@acepe/ui";
import { IconChevronLeft } from "@tabler/icons-svelte";
import { IconChevronRight } from "@tabler/icons-svelte";
import { Button } from "$lib/components/ui/button/index.js";
import * as m from "$lib/messages.js";

import type { ModifiedFilesState } from "../modified-files/types/modified-files-state.js";

interface Props {
	modifiedFilesState: ModifiedFilesState;
	selectedFileIndex: number;
	onClose: () => void;
	onNextFile: () => void;
	onSelectFile: (index: number) => void;
}

let { modifiedFilesState, selectedFileIndex, onClose, onNextFile, onSelectFile }: Props = $props();

const selectedFile = $derived(modifiedFilesState.files[selectedFileIndex]);
const hasNextFile = $derived(selectedFileIndex < modifiedFilesState.files.length - 1);
</script>

<div class="flex flex-col border-b border-border shrink-0">
	<!-- Header with back button, file tabs, and next button -->
	<div class="flex items-center gap-2 px-2 py-1.5 bg-muted/20">
		<!-- Back button -->
		<Button variant="ghost" size="sm" onclick={onClose} class="shrink-0">
			<IconChevronLeft class="h-4 w-4" />
			{m.modified_files_back_button()}
		</Button>

		<!-- File tabs (wrapped row) - same chip as markdown -->
		<div class="flex flex-wrap gap-1 flex-1 min-w-0">
			{#each modifiedFilesState.files as file, index (file.filePath)}
				<FilePathBadge
					filePath={file.filePath}
					fileName={file.fileName}
					linesAdded={file.totalAdded}
					linesRemoved={file.totalRemoved}
					selected={selectedFileIndex === index}
					onSelect={() => onSelectFile(index)}
				/>
			{/each}
		</div>

		<!-- Next file button (only shown when there's a next file) -->
		{#if hasNextFile}
			<Button variant="outline" size="sm" onclick={onNextFile} class="shrink-0">
				{m.modified_files_next_file_button()}
				<IconChevronRight class="h-4 w-4" />
			</Button>
		{/if}
	</div>

	<!-- File info bar (filename only) -->
	{#if selectedFile}
		<div class="px-3 py-2 border-t border-border bg-muted/10">
			<div class="font-mono text-[11px] text-muted-foreground truncate">
				{selectedFile.fileName}
			</div>
			<div class="flex items-center gap-3 text-xs mt-1">
				<span class="font-medium text-success">+{selectedFile.totalAdded}</span>
				<span class="font-medium" style="color: #FF5D5A;">-{selectedFile.totalRemoved}</span>
			</div>
		</div>
	{/if}
</div>
