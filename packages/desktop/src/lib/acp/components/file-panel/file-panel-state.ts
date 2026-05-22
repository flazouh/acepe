import type { FilePanelDisplayOptions } from "./format/types.js";
import type { RawEditorMode } from "./file-panel-raw-editor-mode.js";

export const FILE_PANEL_EDITOR_MODES: readonly RawEditorMode[] = ["write", "read"] as const;

export function getFileNameFromPath(filePath: string): string {
	return filePath.split("/").pop() ?? filePath;
}

export function getFilePanelWidthStyle(input: {
	readonly width: number;
	readonly isFullscreenEmbedded: boolean;
}): string {
	if (input.isFullscreenEmbedded) {
		return "min-width: 0; width: 100%; max-width: 100%;";
	}

	return `min-width: ${input.width}px; width: ${input.width}px; max-width: ${input.width}px;`;
}

export function getDisplayOptionsKey(
	filePath: string,
	displayOptions: FilePanelDisplayOptions
): string {
	return `${filePath}:${displayOptions.defaultMode}:${displayOptions.availableModes.join(",")}`;
}

export function shouldResetFilePanelDisplayMode(input: {
	readonly nextKey: string;
	readonly lastKey: string;
}): boolean {
	return input.nextKey !== input.lastKey;
}

export function shouldShowRawEditorModeControls(input: {
	readonly displayMode: string;
	readonly useReadOnlyPierreView: boolean;
}): boolean {
	return input.displayMode === "raw" && !input.useReadOnlyPierreView;
}
