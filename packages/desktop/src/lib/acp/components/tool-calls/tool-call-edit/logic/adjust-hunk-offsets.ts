import type { FileDiffMetadata } from "@pierre/diffs";

/**
 * Adjusts the line number offsets for all hunks in a FileDiffMetadata.
 *
 * This is used to display correct line numbers in an inline edit diff
 * when the edit occurs at a specific location in the file rather than at line 1.
 *
 * @param fileDiff - The original FileDiffMetadata with hunks starting at line 1
 * @param startLine - The 1-based line number where the edit actually starts in the file
 * @returns A new FileDiffMetadata with adjusted hunk line numbers
 */
export function adjustHunkOffsets(fileDiff: FileDiffMetadata, startLine: number): FileDiffMetadata {
	const offset = startLine - 1;

	return {
		...fileDiff,
		hunks: fileDiff.hunks.map((hunk) => ({
			...hunk,
			additionStart: hunk.additionStart + offset,
			deletionStart: hunk.deletionStart + offset,
		})),
	};
}
