/**
 * Finds the 1-based line number where a search string starts in the file content.
 *
 * @param fileContent - The full content of the file
 * @param searchString - The string to search for in the file
 * @returns The 1-based line number where the search string starts, or null if not found
 */
export function findLineNumber(fileContent: string, searchString: string): number | null {
	const index = fileContent.indexOf(searchString);
	if (index === -1) {
		return null;
	}
	// Count newlines before the found position to determine line number
	// Line numbers are 1-based
	return fileContent.substring(0, index).split("\n").length;
}
