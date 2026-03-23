import { err, ok } from "neverthrow";

/**
 * Represents a single line in a hunk.
 */
export interface HunkLine {
	type: "context" | "addition" | "deletion";
	content: string;
}

/**
 * Represents a hunk (section) in a unified diff.
 * Hunks are delineated by @@ headers.
 */
export interface Hunk {
	/** Starting line number in original file */
	oldStart: number;
	/** Number of lines in original file section */
	oldCount: number;
	/** Starting line number in new file */
	newStart: number;
	/** Number of lines in new file section */
	newCount: number;
	/** The @@ header line */
	header: string;
	/** Individual lines in this hunk */
	lines: HunkLine[];
}

/**
 * Result of parsing a unified diff patch.
 */
export interface PatchParseResult {
	/** Reconstructed "before" file content */
	before: string;
	/** Reconstructed "after" file content */
	after: string;
	/** Parsed hunks for metadata/reference */
	hunks: Hunk[];
}

/**
 * Error type for patch parsing failures.
 */
export interface ParseError {
	type: "binary_file" | "invalid_format" | "malformed_hunk" | "unknown";
	message: string;
}

/**
 * Parse a unified diff patch and reconstruct before/after file contents.
 *
 * Handles edge cases:
 * - Empty files (added files have no before, deleted files have no after)
 * - Binary files (shows as "Binary files differ")
 * - Mode changes (ignored, focus on content)
 * - No newline at EOF (\ No newline marker)
 * - Multi-line hunks and context
 *
 * @param patch - The unified diff patch string
 * @param fileStatus - The file change status (added/modified/deleted/renamed)
 * @returns Result with parsed content or error
 */
export function parsePatchToBeforeAfter(
	patch: string,
	fileStatus: "added" | "modified" | "deleted" | "renamed"
) {
	try {
		// Check for binary file marker
		if (patch.includes("Binary files")) {
			return err({
				type: "binary_file",
				message: "Binary files cannot be displayed in diff view",
			});
		}

		const lines = patch.split("\n");
		const hunks: Hunk[] = [];
		let beforeContent = "";
		let afterContent = "";

		let i = 0;

		// Skip file headers (---, +++)
		while (i < lines.length && (lines[i]?.startsWith("---") || lines[i]?.startsWith("+++"))) {
			i++;
		}

		// Parse hunks
		while (i < lines.length) {
			const line = lines[i];

			// Check for hunk header
			if (line?.startsWith("@@")) {
				const hunkResult = parseHunk(lines, i);
				if (!hunkResult) {
					return err({
						type: "malformed_hunk",
						message: `Failed to parse hunk at line ${i}`,
					});
				}

				const { hunk, endIndex, before, after } = hunkResult;
				hunks.push(hunk);
				beforeContent += before;
				afterContent += after;
				i = endIndex;
			} else {
				i++;
			}
		}

		// Handle added files (no before content)
		if (fileStatus === "added" && beforeContent === "") {
			beforeContent = "";
		}

		// Handle deleted files (no after content)
		if (fileStatus === "deleted" && afterContent === "") {
			afterContent = "";
		}

		return ok({
			before: beforeContent,
			after: afterContent,
			hunks,
		});
	} catch (error) {
		return err({
			type: "unknown",
			message: `Failed to parse patch: ${error instanceof Error ? error.message : String(error)}`,
		});
	}
}

/**
 * Parse a single hunk starting at the given line index.
 * Returns the parsed hunk and the reconstructed before/after content for this hunk.
 */
function parseHunk(
	lines: string[],
	startIndex: number
): {
	hunk: Hunk;
	endIndex: number;
	before: string;
	after: string;
} | null {
	const headerLine = lines[startIndex];
	if (!headerLine?.startsWith("@@")) {
		return null;
	}

	// Parse @@ header: @@ -oldStart,oldCount +newStart,newCount @@
	const match = headerLine.match(/@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/);
	if (!match) {
		return null;
	}

	const oldStart = parseInt(match[1], 10);
	const oldCount = match[2] ? parseInt(match[2], 10) : 1;
	const newStart = parseInt(match[3], 10);
	const newCount = match[4] ? parseInt(match[4], 10) : 1;

	const hunkLines: HunkLine[] = [];
	let beforeContent = "";
	let afterContent = "";
	let i = startIndex + 1;
	let processedLines = 0;

	// Process lines in this hunk
	while (i < lines.length && processedLines < oldCount + newCount) {
		const line = lines[i];

		// Check if we've reached the next hunk or end of file
		if (line?.startsWith("@@") || (line?.startsWith("\\") && line.includes("No newline"))) {
			break;
		}

		if (!line) {
			i++;
			continue;
		}

		// Parse line type from first character
		const firstChar = line[0];

		if (firstChar === " ") {
			// Context line (unchanged)
			const content = line.slice(1);
			hunkLines.push({ type: "context", content });
			beforeContent += `${content}\n`;
			afterContent += `${content}\n`;
			processedLines++;
		} else if (firstChar === "-") {
			// Deletion
			const content = line.slice(1);
			hunkLines.push({ type: "deletion", content });
			beforeContent += `${content}\n`;
			processedLines++;
		} else if (firstChar === "+") {
			// Addition
			const content = line.slice(1);
			hunkLines.push({ type: "addition", content });
			afterContent += `${content}\n`;
			processedLines++;
		} else {
			// Unknown line type - skip
			i++;
			continue;
		}

		i++;
	}

	return {
		hunk: {
			oldStart,
			oldCount,
			newStart,
			newCount,
			header: headerLine,
			lines: hunkLines,
		},
		endIndex: i,
		before: beforeContent,
		after: afterContent,
	};
}
