/**
 * Shared path utilities for workspace-relative display and project name extraction.
 */

/**
 * Extract project name from path.
 * Handles trailing slashes by filtering empty segments.
 */
export function extractProjectName(path: string): string {
	const parts = path.split("/").filter(Boolean);
	return parts[parts.length - 1] || path;
}

/**
 * Make file path workspace-relative for privacy and shorter display.
 * Removes absolute path prefix (username, system structure) and shows path relative to project root.
 * For files outside workspace, returns only the filename for privacy.
 *
 * Use for: queue/tool display, privacy-focused paths.
 *
 * @param absolutePath - The absolute file path from tool arguments
 * @param workspaceRoot - The project root path
 * @returns Workspace-relative path, or just filename if outside workspace
 */
export function makeWorkspaceRelative(absolutePath: string, workspaceRoot: string): string {
	// Normalize paths to handle trailing slashes
	const normalizedRoot = workspaceRoot.endsWith("/") ? workspaceRoot : `${workspaceRoot}/`;

	if (absolutePath.startsWith(normalizedRoot)) {
		// Remove workspace root prefix
		return absolutePath.slice(normalizedRoot.length);
	}
	// Handle exact workspace root (no trailing slash in workspaceRoot)
	if (absolutePath.startsWith(workspaceRoot)) {
		return absolutePath.slice(workspaceRoot.length + 1);
	}

	// File outside workspace - show only filename for privacy
	const parts = absolutePath.split("/");
	return parts[parts.length - 1] || absolutePath;
}
