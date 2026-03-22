import type { ModifiedFileEntry } from "./modified-file-entry.js";

/**
 * Aggregated state of modified files in a session.
 */
export type ModifiedFilesState = {
	/** List of aggregated modified files */
	readonly files: ReadonlyArray<ModifiedFileEntry>;
	/** O(1) lookup by file path */
	readonly byPath: ReadonlyMap<string, ModifiedFileEntry>;
	/** Total file count */
	readonly fileCount: number;
	/** Total edits across all files */
	readonly totalEditCount: number;
};
