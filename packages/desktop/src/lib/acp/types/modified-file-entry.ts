/**
 * Aggregated data for a single modified file across all edits in a session.
 */
export type ModifiedFileEntry = {
	/** Full file path */
	readonly filePath: string;
	/** File name (basename) */
	readonly fileName: string;
	/** Total lines added across all edits */
	readonly totalAdded: number;
	/** Total lines removed across all edits */
	readonly totalRemoved: number;
	/** Original content before first edit (null if unknown) */
	readonly originalContent: string | null;
	/** Final content after last edit (null if unknown) */
	readonly finalContent: string | null;
	/** Number of edit operations */
	readonly editCount: number;
};
