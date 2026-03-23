export function getNextExpandedPrFilePath(
	currentPath: string | null,
	clickedPath: string
): string | null {
	if (currentPath === clickedPath) {
		return null;
	}

	return clickedPath;
}
