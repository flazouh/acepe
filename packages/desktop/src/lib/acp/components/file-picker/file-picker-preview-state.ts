import type { FilePickerEntry } from "../../types/file-picker-entry.js";

export function shouldDeferFilePreview(query: string): boolean {
	return query.trim().length > 0;
}

export function getPreviewFile(
	filteredFiles: FilePickerEntry[],
	selectedIndex: number,
	deferPreview: boolean
): FilePickerEntry | null {
	if (filteredFiles.length === 0) {
		return null;
	}

	if (deferPreview) {
		return null;
	}

	const clampedIndex = Math.max(0, Math.min(selectedIndex, filteredFiles.length - 1));
	const file = filteredFiles[clampedIndex];
	return file ? file : null;
}

export function getFilePreviewName(filePath: string): string {
	return filePath.split("/").pop() ?? filePath;
}

export function getFilePreviewCacheKeys(input: {
	readonly projectPath: string;
	readonly filePath: string;
}): {
	readonly file: string;
	readonly diffOld: string;
	readonly diffOldEmpty: string;
	readonly diffNew: string;
} {
	const suffix = `${input.projectPath}-${input.filePath}`;
	return {
		file: `file-${suffix}`,
		diffOld: `diff-old-${suffix}`,
		diffOldEmpty: `diff-old-empty-${suffix}`,
		diffNew: `diff-new-${suffix}`,
	};
}

export function shouldRenderFilePreviewDiff(file: FilePickerEntry): boolean {
	return file.gitStatus !== null;
}
