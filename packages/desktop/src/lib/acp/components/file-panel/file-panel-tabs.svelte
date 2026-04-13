<script lang="ts">
import { FilePathBadge } from "@acepe/ui";
import { IconX } from "@tabler/icons-svelte";
import type { FilePanel as FilePanelType } from "$lib/acp/store/file-panel-type.js";
import * as m from "$lib/messages.js";

import FilePanel from "./file-panel.svelte";

interface Props {
	filePanels: readonly FilePanelType[];
	activeFilePanelId: string | null;
	projectName: string;
	projectColor: string | undefined;
	onSelectFilePanel: (panelId: string) => void;
	onCloseFilePanel: (panelId: string) => void;
	onResizeFilePanel: (panelId: string, delta: number) => void;
}

let {
	filePanels,
	activeFilePanelId,
	projectName,
	projectColor,
	onSelectFilePanel,
	onCloseFilePanel,
	onResizeFilePanel,
}: Props = $props();

const activeFilePanel = $derived.by(() => {
	const active =
		activeFilePanelId !== null
			? filePanels.find((panel) => panel.id === activeFilePanelId)
			: undefined;
	return active ?? filePanels[0] ?? null;
});
</script>

{#if activeFilePanel}
	<div class="flex h-full min-h-0 shrink-0 flex-col gap-0 overflow-hidden" style="min-width: {activeFilePanel.width}px; width: {activeFilePanel.width}px; max-width: {activeFilePanel.width}px; flex-basis: {activeFilePanel.width}px;">
		{#if filePanels.length > 1}
			<div class="flex min-h-8 shrink-0 items-center overflow-x-auto border-b border-border bg-muted/20">
				{#each filePanels as filePanel (filePanel.id)}
					{@const fileName = filePanel.filePath.split("/").pop() ?? filePanel.filePath}
					<div
						class="file-tab group inline-flex h-7 shrink-0 items-center gap-1 px-2 text-xs transition-colors {activeFilePanel.id === filePanel.id
							? 'bg-accent/25 text-foreground'
							: 'text-muted-foreground hover:bg-accent/15 hover:text-foreground'}"
					>
						<button
							type="button"
							class="min-w-0"
							onclick={() => onSelectFilePanel(filePanel.id)}
							title={filePanel.filePath}
						>
							<FilePathBadge
								filePath={filePanel.filePath}
								{fileName}
								interactive={false}
								selected={activeFilePanel.id === filePanel.id}
							/>
						</button>
						<button
							type="button"
							class="inline-flex h-4 w-4 items-center justify-center rounded opacity-50 hover:opacity-100 hover:bg-muted-foreground/10"
							onclick={() => onCloseFilePanel(filePanel.id)}
							title="Close tab"
						>
							<IconX class="h-3 w-3" />
						</button>
					</div>
				{/each}
			</div>
		{/if}
		<div class="min-h-0 flex-1 overflow-hidden">
			<FilePanel
				panelId={activeFilePanel.id}
				filePath={activeFilePanel.filePath}
				projectPath={activeFilePanel.projectPath}
				{projectName}
				{projectColor}
				width={activeFilePanel.width}
				hideProjectBadge={true}
				onClose={() => onCloseFilePanel(activeFilePanel.id)}
				onResize={onResizeFilePanel}
			/>
		</div>
	</div>
{/if}

<style>
	.file-tab :global(.file-path-badge),
	.file-tab :global(.file-path-badge:hover),
	.file-tab :global(.file-path-badge-selected) {
		background: transparent !important;
	}
</style>
