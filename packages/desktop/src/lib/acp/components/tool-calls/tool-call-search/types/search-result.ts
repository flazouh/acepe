/**
 * A single match from grep output.
 */
export interface SearchMatch {
	/** Full file path */
	filePath: string;
	/** File name only (extracted from path) */
	fileName: string;
	/** Line number in the file */
	lineNumber: number;
	/** Line content */
	content: string;
	/** True if this is a match line, false if context line */
	isMatch: boolean;
}

/**
 * Parsed search/grep result.
 */
export interface SearchResult {
	/** Result mode: content (with lines), files (paths only), or count */
	mode: "content" | "files" | "count";
	/** Number of files with matches */
	numFiles: number;
	/** Number of matching lines (content mode only) */
	numMatches?: number;
	/** Parsed matches with line numbers and content (content mode) */
	matches: SearchMatch[];
	/** File paths only (files mode) */
	files: string[];
}
