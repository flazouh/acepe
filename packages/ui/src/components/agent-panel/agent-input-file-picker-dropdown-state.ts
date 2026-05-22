export interface AgentInputFilePickerEntry {
	path: string;
	extension: string;
	lineCount: number;
	gitStatus: {
		path: string;
		status: string;
		insertions: number;
		deletions: number;
	} | null;
}

export const FILE_PICKER_DROPDOWN_WIDTH = 700;
export const FILE_PICKER_DROPDOWN_HEIGHT = 280;
export const FILE_PICKER_DROPDOWN_PADDING = 16;
export const FILE_PICKER_RESULT_LIMIT = 10;

export function getFilePickerFileName(path: string): string {
	const lastSlash = path.lastIndexOf("/");
	return lastSlash >= 0 ? path.slice(lastSlash + 1) : path;
}

export function calculateFilePickerScore(
	queryValue: string,
	file: AgentInputFilePickerEntry
): number | null {
	const lowerQuery = queryValue.toLowerCase();
	const fileName = getFilePickerFileName(file.path).toLowerCase();
	const filePath = file.path.toLowerCase();

	const fileNameIndex = fileName.indexOf(lowerQuery);
	if (fileNameIndex >= 0) {
		return 1000 + (100 - fileNameIndex);
	}

	const pathIndex = filePath.indexOf(lowerQuery);
	if (pathIndex >= 0) {
		return 500 + (100 - pathIndex);
	}

	let queryIndex = 0;
	let score = 0;
	let consecutiveBonus = 0;

	for (
		let index = 0;
		index < fileName.length && queryIndex < lowerQuery.length;
		index += 1
	) {
		if (fileName[index] === lowerQuery[queryIndex]) {
			score += 10 + consecutiveBonus;
			consecutiveBonus += 5;
			queryIndex += 1;
		} else {
			consecutiveBonus = 0;
		}
	}

	if (queryIndex === lowerQuery.length) {
		return score;
	}

	queryIndex = 0;
	score = 0;
	consecutiveBonus = 0;

	for (
		let index = 0;
		index < filePath.length && queryIndex < lowerQuery.length;
		index += 1
	) {
		if (filePath[index] === lowerQuery[queryIndex]) {
			score += 1 + consecutiveBonus;
			consecutiveBonus += 1;
			queryIndex += 1;
		} else {
			consecutiveBonus = 0;
		}
	}

	return queryIndex === lowerQuery.length ? score : null;
}

export function getFilteredFilePickerFiles(
	files: readonly AgentInputFilePickerEntry[],
	query: string
): readonly AgentInputFilePickerEntry[] {
	if (query.length === 0) {
		return files.slice(0, FILE_PICKER_RESULT_LIMIT);
	}

	const results: Array<{ item: AgentInputFilePickerEntry; score: number }> = [];

	for (const file of files) {
		const score = calculateFilePickerScore(query, file);
		if (score !== null) {
			results.push({ item: file, score });
		}
	}

	results.sort((left, right) => {
		if (right.score !== left.score) {
			return right.score - left.score;
		}
		return left.item.path.length - right.item.path.length;
	});

	return results.slice(0, FILE_PICKER_RESULT_LIMIT).map((result) => result.item);
}

export function getFilePickerPosition(input: {
	position: { top: number; left: number };
	viewportWidth: number;
}): { top: number; left: number } {
	const left = Math.max(
		FILE_PICKER_DROPDOWN_PADDING,
		Math.min(
			input.position.left,
			input.viewportWidth -
				FILE_PICKER_DROPDOWN_WIDTH -
				FILE_PICKER_DROPDOWN_PADDING
		)
	);
	const top = input.position.top - FILE_PICKER_DROPDOWN_HEIGHT - 8;

	return { top, left };
}

export function getEffectiveFilePickerIndex(input: {
	selectedIndex: number;
	fileCount: number;
}): number {
	if (input.fileCount === 0) return 0;
	return Math.max(0, Math.min(input.selectedIndex, input.fileCount - 1));
}

export function getNextFilePickerIndex(input: {
	currentIndex: number;
	fileCount: number;
	direction: "down" | "up";
}): number {
	if (input.fileCount === 0) return 0;
	if (input.direction === "down") {
		return (input.currentIndex + 1) % input.fileCount;
	}
	return input.currentIndex <= 0 ? input.fileCount - 1 : input.currentIndex - 1;
}

export function shouldDeferFilePickerPreview(query: string): boolean {
	return query.trim().length > 0;
}

export function getFilePickerPreviewFile(input: {
	filteredFiles: readonly AgentInputFilePickerEntry[];
	deferPreview: boolean;
	effectiveSelectedIndex: number;
}): AgentInputFilePickerEntry | null {
	if (input.filteredFiles.length === 0 || input.deferPreview) {
		return null;
	}

	return input.filteredFiles[input.effectiveSelectedIndex] ?? null;
}
