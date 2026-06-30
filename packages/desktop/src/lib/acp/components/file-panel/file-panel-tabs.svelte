<script lang="ts">
import { FilePathBadge, RoundedIcon } from "@acepe/ui";
import type { FilePanel as FilePanelType } from "$lib/acp/store/file-panel-type.js";
import FilePanel from "./file-panel.svelte";
import { buildFilePanelTabsViewState } from "./file-panel-tabs-state.js";

interface Props {
	filePanels: readonly FilePanelType[];
	activeFilePanelId: string | null;
	projectName: string;
	projectColor: string | undefined;
	projectIconSrc?: string | null;
	onSelectFilePanel: (panelId: string) => void;
	onCloseFilePanel: (panelId: string) => void;
	onResizeFilePanel: (panelId: string, delta: number) => void;
}

let {
	filePanels,
	activeFilePanelId,
	projectName,
	projectColor,
	projectIconSrc = null,
	onSelectFilePanel,
	onCloseFilePanel,
	onResizeFilePanel,
}: Props = $props();

const viewState = $derived(buildFilePanelTabsViewState({ filePanels, activeFilePanelId }));
</script>

{#if viewState.activeFilePanel}
	{@const activeFilePanel = viewState.activeFilePanel}
	<div class="flex h-full min-h-0 shrink-0 flex-col gap-0 overflow-hidden" style={viewState.widthStyle}>
		{#if viewState.showTabs}
			<div class="flex min-h-8 shrink-0 items-center overflow-x-auto border-b border-border bg-muted/20">
				{#each viewState.tabs as tab (tab.id)}
					<div
						class="file-tab group inline-flex h-7 shrink-0 items-center gap-1 px-2 text-xs transition-colors {tab.className}"
					>
						<button
							type="button"
							class="min-w-0"
							onclick={() => onSelectFilePanel(tab.id)}
							title={tab.filePath}
						>
							<FilePathBadge
								filePath={tab.filePath}
								fileName={tab.fileName}
								interactive={false}
								selected={tab.isSelected}
							/>
						</button>
						<button
							type="button"
							class="inline-flex h-4 w-4 items-center justify-center rounded opacity-50 hover:opacity-100 hover:bg-muted-foreground/10"
							onclick={() => onCloseFilePanel(tab.id)}
							title="Close tab"
						>
							<RoundedIcon name="close" class="h-3 w-3" />
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
				{projectIconSrc}
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
		border: none !important;
	}
</style>
