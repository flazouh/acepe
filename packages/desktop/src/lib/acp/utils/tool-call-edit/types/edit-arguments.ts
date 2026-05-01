/**
 * Extracted arguments from an edit tool call.
 *
 * Contains the file path, old content, and new content for rendering the diff.
 */
export type EditArguments = {
	/**
	 * The file path being edited.
	 */
	readonly filePath: string | null;

	/**
	 * The old content (before edit).
	 */
	readonly oldString: string | null;

	/**
	 * The new content (after edit).
	 */
	readonly newString: string | null;
};
