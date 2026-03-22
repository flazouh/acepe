/**
 * File information extracted from a tool call.
 *
 * Contains metadata about the file being edited, including path,
 * name, diff statistics, and whether it's a markdown file.
 */
export type FileInfo = {
	/**
	 * The file path being edited.
	 */
	readonly filePath: string | null;

	/**
	 * The file name extracted from the path.
	 */
	readonly fileName: string | null;

	/**
	 * Diff statistics showing added and removed lines.
	 */
	readonly diffStats: { added: number; removed: number } | null;

	/**
	 * Whether the file is a markdown file.
	 */
	readonly isMarkdown: boolean;
};
