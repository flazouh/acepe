import type { FilePanel } from "./file-panel-type.js";

export type OpenFilePanelOptions = {
	ownerPanelId?: string;
	width?: number;
};

export function normalizeOpenFilePanelOptions(
	options?: OpenFilePanelOptions | number
): OpenFilePanelOptions {
	return typeof options === "number" ? { width: options } : (options ?? {});
}

export function createFilePanelCacheKey(
	filePath: string,
	projectPath: string,
	ownerPanelId: string | null
): string {
	return `${ownerPanelId ?? "global"}:${projectPath}:${filePath}`;
}

export function getFirstAttachedFilePanelId(
	filePanels: readonly FilePanel[],
	ownerPanelId: string
): string | null {
	const first = filePanels.find((panel) => panel.ownerPanelId === ownerPanelId);
	return first?.id ?? null;
}

export function remapOwnerPanelId(
	ownerPanelId: string | null,
	ownerPanelIdMap: ReadonlyMap<string, string>
): string | null {
	if (ownerPanelId === null) return null;
	return ownerPanelIdMap.get(ownerPanelId) ?? ownerPanelId;
}
