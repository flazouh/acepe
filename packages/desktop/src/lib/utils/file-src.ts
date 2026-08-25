/**
 * Turn a filesystem path into a URL the webview can load.
 * Local files use the file: scheme. Existing web/data/asset URLs stay as-is.
 */
export function convertFileSrc(path: string): string {
	if (
		path.startsWith("http://") ||
		path.startsWith("https://") ||
		path.startsWith("data:") ||
		path.startsWith("asset://") ||
		path.startsWith("file://")
	) {
		return path;
	}
	if (path.startsWith("/")) {
		return `file://${path}`;
	}
	return `file:///${path}`;
}
