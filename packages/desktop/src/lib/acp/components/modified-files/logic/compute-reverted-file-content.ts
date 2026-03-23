import type { FileDiffMetadata } from "@pierre/diffs";

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
	// Get the hunk to revert
	const hunk = fileDiffMetadata.hunks[hunkIndex];
	if (!hunk) {
		// Hunk index out of bounds, return original content
		return newFileContent;
	}

	// Handle empty file content specially
	// "".split("\n") returns [""] which would cause issues
	const lines = newFileContent === "" ? [] : newFileContent.split("\n");

	// Track current position in the new file (0-indexed)
	// additionStart is 1-indexed, so subtract 1
	let currentLineIndex = hunk.additionStart - 1;

	// Collect all changes to apply
	// We process from end to start so that indices remain valid
	const changes: Array<{
		startIndex: number;
		deleteCount: number;
		insertLines: string[];
	}> = [];

	// Process each content block in the hunk
	for (const content of hunk.hunkContent) {
		if (content.type === "context") {
			// Skip past context lines - they exist in both old and new
			currentLineIndex += content.lines.length;
		} else if (content.type === "change") {
			// For a change block:
			// - additions.length lines exist in the new file at currentLineIndex
			// - deletions.length lines should replace them
			changes.push({
				startIndex: currentLineIndex,
				deleteCount: content.additions.length,
				insertLines: content.deletions,
			});

			// Move past the additions in the new file
			currentLineIndex += content.additions.length;
		}
	}

	// Apply changes from end to start so indices stay valid
	for (let i = changes.length - 1; i >= 0; i--) {
		const change = changes[i];
		lines.splice(change.startIndex, change.deleteCount, ...change.insertLines);
	}

	// Join the lines back together
	return lines.join("\n");
}
