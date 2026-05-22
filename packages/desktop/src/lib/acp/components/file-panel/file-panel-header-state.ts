import type { FilePanelDisplayMode } from "./format/types.js";

export interface FilePanelHeaderModeItem<T extends string = string> {
	id: T;
	label: string;
}

export function getFilePanelFullPath(input: { filePath: string; projectPath: string }): string {
	return input.filePath.startsWith("/") ? input.filePath : `${input.projectPath}/${input.filePath}`;
}

export function getFilePanelDisplayModeLabel(mode: FilePanelDisplayMode): string {
	if (mode === "rendered") return "Preview";
	if (mode === "structured") return "Tree";
	if (mode === "table") return "Table";
	return "Source";
}

export function getFilePanelDisplayModeItems(
	displayModes: readonly FilePanelDisplayMode[]
): FilePanelHeaderModeItem<FilePanelDisplayMode>[] {
	return displayModes.map((mode) => ({ id: mode, label: getFilePanelDisplayModeLabel(mode) }));
}

export function getFilePanelEditorModeItems(
	editorModes: readonly ("write" | "read")[]
): FilePanelHeaderModeItem<"write" | "read">[] {
	return editorModes.map((mode) => ({
		id: mode,
		label: mode === "write" ? "Write" : "Read",
	}));
}

export function getFilePanelEffectiveProjectColor(projectColor: string | undefined): string {
	return projectColor ?? "";
}
