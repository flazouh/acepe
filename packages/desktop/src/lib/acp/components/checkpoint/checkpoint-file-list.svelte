<script lang="ts">
import { FilePathBadge, PillButton, RevertIcon } from "@acepe/ui";
import { toast } from "svelte-sonner";
import { Spinner } from "$lib/components/ui/spinner/index.js";
import * as m from "$lib/messages.js";
import { checkpointStore } from "../../store/checkpoint-store.svelte.js";
import type { FileSnapshot } from "../../types/checkpoint.js";

interface Props {
	sessionId: string;
	checkpointId: string;
	projectPath: string;
	files: FileSnapshot[];
}

let { sessionId, checkpointId, projectPath, files }: Props = $props();

let revertingFilePath = $state<string | null>(null);

async function handleRevertFile(filePath: string) {
	revertingFilePath = filePath;

	const result = await checkpointStore.revertFile(sessionId, checkpointId, filePath, projectPath);

	result.match(
		() => {
			toast.success(m.checkpoint_file_reverted({ filePath: getFileName(filePath) }));
		},
		(error) => {
			toast.error(m.checkpoint_file_revert_failed({ error: error.message }));
		}
	);

	revertingFilePath = null;
}

function getFileName(filePath: string): string {
	return filePath.split("/").pop() ?? filePath;
}

function formatFileSize(bytes: number): string {
	if (bytes < 1024) return `${bytes} B`;
	if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
	return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
</script>

<div class="px-2 py-1 space-y-0.5">
	{#each files.filter((f) => (f.linesAdded ?? 0) > 0 || (f.linesRemoved ?? 0) > 0) as file (file.id)}
		<div
			class="flex items-center justify-between gap-1.5 py-0.5 px-1.5 rounded
				   hover:bg-muted/30 group transition-colors"
		>
			<div class="flex items-center gap-1.5 min-w-0 flex-1">
				<FilePathBadge
					filePath={file.filePath}
					linesAdded={file.linesAdded ?? 0}
					linesRemoved={file.linesRemoved ?? 0}
					interactive={false}
				/>
				{#if file.linesAdded === null && file.linesRemoved === null && file.fileSize !== undefined}
					<span class="text-[9px] text-muted-foreground shrink-0">
						{formatFileSize(file.fileSize)}
					</span>
				{/if}
			</div>

			<div class="opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
				{#if revertingFilePath === file.filePath}
					<PillButton variant="soft" size="sm" disabled>
						<Spinner class="h-2.5 w-2.5" />
					</PillButton>
				{:else}
					<PillButton variant="soft" size="sm" onclick={() => handleRevertFile(file.filePath)}>
						{#snippet trailingIcon()}
							<RevertIcon size="sm" />
						{/snippet}
					</PillButton>
				{/if}
			</div>
		</div>
	{/each}
</div>

<!-- Uses global fadeSlideIn animation from app.css -->
