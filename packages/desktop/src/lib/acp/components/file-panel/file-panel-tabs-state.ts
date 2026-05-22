import type { FilePanel } from "$lib/acp/store/file-panel-type.js";

export interface FilePanelTabView {
	id: string;
	filePath: string;
	fileName: string;
	isSelected: boolean;
	className: string;
}

export interface FilePanelTabsViewState {
	activeFilePanel: FilePanel | null;
	showTabs: boolean;
	widthStyle: string;
	tabs: FilePanelTabView[];
}

export function buildFilePanelTabsViewState(input: {
	filePanels: readonly FilePanel[];
	activeFilePanelId: string | null;
}): FilePanelTabsViewState {
	const activeFilePanel = getActiveFilePanel(input.filePanels, input.activeFilePanelId);

	return {
		activeFilePanel,
		showTabs: input.filePanels.length > 1,
		widthStyle: activeFilePanel ? getFilePanelTabsWidthStyle(activeFilePanel.width) : "",
		tabs: input.filePanels.map((panel) => buildFilePanelTabView(panel, activeFilePanel?.id ?? null)),
	};
}

export function getActiveFilePanel(
	filePanels: readonly FilePanel[],
	activeFilePanelId: string | null
): FilePanel | null {
	const active =
		activeFilePanelId !== null
			? filePanels.find((panel) => panel.id === activeFilePanelId)
			: undefined;

	return active ?? filePanels[0] ?? null;
}

export function getFilePanelTabFileName(filePath: string): string {
	return filePath.split("/").pop() ?? filePath;
}

export function getFilePanelTabsWidthStyle(width: number): string {
	return `min-width: ${width}px; width: ${width}px; max-width: ${width}px; flex-basis: ${width}px;`;
}

function buildFilePanelTabView(panel: FilePanel, activePanelId: string | null): FilePanelTabView {
	const isSelected = panel.id === activePanelId;

	return {
		id: panel.id,
		filePath: panel.filePath,
		fileName: getFilePanelTabFileName(panel.filePath),
		isSelected,
		className: isSelected
			? "bg-accent/25 text-foreground"
			: "text-muted-foreground hover:bg-accent/15 hover:text-foreground",
	};
}
