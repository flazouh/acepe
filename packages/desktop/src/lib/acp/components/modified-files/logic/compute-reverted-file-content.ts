import { type FileDiffMetadata, SPLIT_WITH_NEWLINES } from "@pierre/diffs";

type LegacyContextContent = {
	type: "context";
	lines: number;
	noEOFCR: boolean;
	additionLineIndex?: number;
	deletionLineIndex?: number;
};

type LegacyChangeContent = {
	type: "change";
	deletions: number;
	additions: number;
	deletionLineIndex: number;
	additionLineIndex: number;
	noEOFCRDeletions: boolean;
	noEOFCRAdditions: boolean;
};

type CompatibleHunkContent = FileDiffMetadata["hunks"][number]["hunkContent"][number] | LegacyContextContent | LegacyChangeContent;
type CompatibleFileDiffMetadata = FileDiffMetadata & {
	deletionLines?: string[];
	additionLines?: string[];
};

function appendLines(target: string[], source: string[]): void {
	for (const line of source) {
		target.push(line);
	}
}

function splitFileContent(contents: string): string[] {
	return contents === "" ? [] : contents.split(SPLIT_WITH_NEWLINES);
}

function getContentLineCount(lines: string[] | number): number {
	return Array.isArray(lines) ? lines.length : lines;
}

function getLegacyOldLines(fileDiffMetadata: CompatibleFileDiffMetadata): string[] {
	return fileDiffMetadata.deletionLines ?? [];
}

function getChangeDeletionLines(
	fileDiffMetadata: CompatibleFileDiffMetadata,
	content: CompatibleHunkContent
): string[] {
	if (content.type !== "change") {
		return [];
	}

	return getLegacyOldLines(fileDiffMetadata).slice(
		content.deletionLineIndex,
		content.deletionLineIndex + content.deletions
	);
}

/**
 * Computes the full file content with a specific hunk reverted.
 *
 * When a hunk is rejected, we need to:
 * 1. Take the new file content (current state)
 * 2. Find each change block in the hunk
 * 3. Replace additions with deletions while preserving context
 * 4. Return the resulting content
 *
 * @param newFileContent - The current content of the file (with all changes applied)
 * @param fileDiffMetadata - The diff metadata containing hunk information
 * @param hunkIndex - The index of the hunk to revert
 * @returns The file content with the specified hunk reverted
 */
export function computeRevertedFileContent(
	newFileContent: string,
	fileDiffMetadata: FileDiffMetadata,
	hunkIndex: number
): string {
	const compatibleMetadata = fileDiffMetadata as CompatibleFileDiffMetadata;
	const hunk = compatibleMetadata.hunks[hunkIndex];
	if (!hunk) {
		return newFileContent;
	}

	const currentAdditionLines = splitFileContent(newFileContent);
	const hunkAdditionStartIndex = Math.max(0, hunk.additionStart - 1);
	if (hunkAdditionStartIndex > currentAdditionLines.length) {
		return newFileContent;
	}

	const revertedLines = currentAdditionLines.slice(0, hunkAdditionStartIndex);
	let nextCurrentLineIndex = hunkAdditionStartIndex;

	for (const content of hunk.hunkContent as CompatibleHunkContent[]) {
		if (content.type === "context") {
			const contextLineCount = getContentLineCount(content.lines);
			appendLines(
				revertedLines,
				currentAdditionLines.slice(
					nextCurrentLineIndex,
					nextCurrentLineIndex + contextLineCount
				)
			);
			nextCurrentLineIndex += contextLineCount;
			continue;
		}

		appendLines(revertedLines, getChangeDeletionLines(compatibleMetadata, content));
		nextCurrentLineIndex += getContentLineCount(content.additions);
	}

	appendLines(revertedLines, currentAdditionLines.slice(nextCurrentLineIndex));
	return revertedLines.join("");
}
