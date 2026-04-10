import { type FileDiffMetadata, SPLIT_WITH_NEWLINES } from "@pierre/diffs";

function appendLines(target: string[], source: string[]): void {
	for (const line of source) {
		target.push(line);
	}
}

function splitFileContent(contents: string): string[] {
	return contents === "" ? [] : contents.split(SPLIT_WITH_NEWLINES);
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
	const hunk = fileDiffMetadata.hunks[hunkIndex];
	if (!hunk) {
		return newFileContent;
	}

	const currentAdditionLines = splitFileContent(newFileContent);
	if (hunk.additionLineIndex > currentAdditionLines.length) {
		return newFileContent;
	}

	const revertedLines = currentAdditionLines.slice(0, hunk.additionLineIndex);
	let nextCurrentLineIndex = hunk.additionLineIndex;

	for (const content of hunk.hunkContent) {
		if (content.type === "context") {
			appendLines(
				revertedLines,
				currentAdditionLines.slice(nextCurrentLineIndex, nextCurrentLineIndex + content.lines)
			);
			nextCurrentLineIndex += content.lines;
			continue;
		}

		appendLines(
			revertedLines,
			fileDiffMetadata.deletionLines.slice(
				content.deletionLineIndex,
				content.deletionLineIndex + content.deletions
			)
		);
		nextCurrentLineIndex += content.additions;
	}

	appendLines(revertedLines, currentAdditionLines.slice(nextCurrentLineIndex));
	return revertedLines.join("");
}
