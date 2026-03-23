import { createLogger } from "./logger.js";

const logger = createLogger({ id: "file-utils", name: "FileUtils" });

/**
 * Convert an absolute file path to a relative path by stripping the project path prefix.
 * Used for matching against git status results which use relative paths.
 *
 * @param filePath - The file path (can be absolute or relative)
 * @param projectPath - The project root path to strip
 * @returns The relative path, or the original path if not under projectPath
 */
export function getRelativeFilePath(
	filePath: string | null | undefined,
	projectPath: string | null | undefined
): string | null {
	if (!filePath || !projectPath) return null;

	// If filePath starts with projectPath, strip it to get relative path
	if (filePath.startsWith(projectPath)) {
		const relative = filePath.slice(projectPath.length);
		// Remove leading slash if present
		return relative.startsWith("/") ? relative.slice(1) : relative;
	}

	// Already relative or different root
	return filePath;
}

type GitStatusLike = {
	path: string;
	status: string;
	insertions: number;
	deletions: number;
};

function normalizePathForGitMatch(path: string): string {
	const normalizedSlashes = path.replaceAll("\\", "/");
	if (normalizedSlashes.startsWith("./")) {
		return normalizedSlashes.slice(2);
	}
	if (normalizedSlashes.startsWith("/")) {
		return normalizedSlashes.slice(1);
	}
	return normalizedSlashes;
}

export function findGitStatusForFile<T extends GitStatusLike>(
	statuses: ReadonlyArray<T>,
	filePath: string | null | undefined,
	projectPath: string | null | undefined
): T | null {
	const relativeFilePath = getRelativeFilePath(filePath, projectPath);
	if (!relativeFilePath) {
		logger.debug("findGitStatusForFile: no relative file path", { filePath, projectPath });
		return null;
	}

	const normalizedTargetPath = normalizePathForGitMatch(relativeFilePath);
	const exactMatch = statuses.find(
		(status) => normalizePathForGitMatch(status.path) === normalizedTargetPath
	);
	if (exactMatch) {
		logger.debug("findGitStatusForFile: exact match", {
			filePath,
			projectPath,
			normalizedTargetPath,
			statusPath: exactMatch.path,
			status: exactMatch.status,
			insertions: exactMatch.insertions,
			deletions: exactMatch.deletions,
		});
		return exactMatch;
	}

	// Nested project roots can return repo-root-relative paths from backend
	// (e.g. "nested/src/main.ts" while target is "src/main.ts").
	const suffixMatches = statuses.filter((status) => {
		const candidate = normalizePathForGitMatch(status.path);
		return candidate.endsWith(`/${normalizedTargetPath}`);
	});

	if (suffixMatches.length === 1) {
		const suffixMatch = suffixMatches[0]!;
		logger.debug("findGitStatusForFile: suffix match", {
			filePath,
			projectPath,
			normalizedTargetPath,
			statusPath: suffixMatch.path,
			status: suffixMatch.status,
			insertions: suffixMatch.insertions,
			deletions: suffixMatch.deletions,
		});
		return suffixMatches[0] ?? null;
	}

	if (suffixMatches.length > 1) {
		logger.debug("findGitStatusForFile: ambiguous suffix matches", {
			filePath,
			projectPath,
			normalizedTargetPath,
			candidates: suffixMatches.map((s) => s.path),
		});
	}

	logger.debug("findGitStatusForFile: no match", {
		filePath,
		projectPath,
		normalizedTargetPath,
		statusCount: statuses.length,
	});
	return null;
}

/**
 * Compound extensions that should be treated as a single unit.
 * Examples: .svelte.ts, .d.ts, .test.ts, .module.css
 */
const COMPOUND_EXTENSIONS = new Set([
	"svelte.ts",
	"svelte.js",
	"d.ts",
	"test.ts",
	"test.js",
	"spec.ts",
	"spec.js",
	"module.css",
	"module.scss",
	"module.sass",
]);

/**
 * Get file extension from a file path.
 *
 * @param filePath - The file path
 * @returns The file extension (without dot) or empty string
 */
export function getFileExtension(filePath: string | null | undefined): string {
	if (!filePath) return "";
	const parts = filePath.split(".");
	return parts.length > 1 ? parts[parts.length - 1] : "";
}

/**
 * Get file extension with support for compound extensions.
 * Returns extension with leading dot (e.g., ".ts", ".svelte.ts").
 * Handles compound extensions like .svelte.ts, .d.ts, .test.ts, etc.
 *
 * @param fileName - The file name or path
 * @returns The file extension with dot (e.g., ".ts", ".svelte.ts") or empty string
 */
export function getFileExtensionWithDot(fileName: string | null | undefined): string {
	if (!fileName) return "";

	// Check compound extensions first
	for (const ext of COMPOUND_EXTENSIONS) {
		if (fileName.toLowerCase().endsWith(`.${ext}`)) {
			return `.${ext}`;
		}
	}

	// Fall back to simple extension
	const parts = fileName.split(".");
	if (parts.length <= 1) return "";
	return `.${parts[parts.length - 1]}`;
}

/**
 * Get file name from a file path.
 *
 * @param filePath - The file path
 * @returns The file name with extension
 */
export function getFileName(filePath: string | null | undefined): string {
	if (!filePath) return "";
	const parts = filePath.split("/");
	return parts[parts.length - 1] || filePath;
}

/**
 * Calculate diff statistics from edit arguments.
 *
 * Uses a proper diff algorithm to count actual added/removed lines,
 * not just total line counts.
 *
 * @param arguments_ - Tool call arguments (can be any JsonValue)
 * @returns Object with added and removed line counts, or null if not available
 */
export function calculateDiffStats(arguments_: unknown): { added: number; removed: number } | null {
	if (!arguments_ || typeof arguments_ !== "object" || Array.isArray(arguments_)) return null;
	const args = arguments_ as Record<string, unknown>;

	// Check for new_string and old_string
	const newString = args.new_string;
	const oldString = args.old_string;

	if (typeof newString === "string" && typeof oldString === "string") {
		return computeActualDiffStats(oldString, newString);
	}

	// Check for content (full file content)
	if ("content" in args && typeof args.content === "string") {
		const content = args.content;
		// If we have old_string, calculate actual diff
		if (typeof oldString === "string") {
			return computeActualDiffStats(oldString, content);
		}
		// New file - all lines are additions
		const lines = content.split("\n").length;
		return { added: lines, removed: 0 };
	}

	return null;
}

/**
 * Computes actual added/removed line counts using a simple diff algorithm.
 *
 * Uses line-by-line comparison to count lines that are truly added or removed,
 * not just total line counts.
 *
 * @param oldString - The original string
 * @param newString - The new string
 * @returns Object with added and removed line counts
 */
function computeActualDiffStats(
	oldString: string,
	newString: string
): { added: number; removed: number } {
	const oldLines = oldString.split("\n");
	const newLines = newString.split("\n");

	// Use a simple LCS-based approach to find common lines
	// Create sets for quick lookup
	const oldLineSet = new Map<string, number>();
	for (const line of oldLines) {
		oldLineSet.set(line, (oldLineSet.get(line) ?? 0) + 1);
	}

	// Count lines in new that exist in old (common lines)
	const newLineSet = new Map<string, number>();
	for (const line of newLines) {
		newLineSet.set(line, (newLineSet.get(line) ?? 0) + 1);
	}

	// Calculate common lines (minimum of occurrences in both)
	let commonCount = 0;
	for (const [line, newCount] of newLineSet) {
		const oldCount = oldLineSet.get(line) ?? 0;
		commonCount += Math.min(oldCount, newCount);
	}

	// Added = new lines - common lines
	// Removed = old lines - common lines
	const added = newLines.length - commonCount;
	const removed = oldLines.length - commonCount;

	return { added, removed };
}

/**
 * Extract line numbers from read arguments.
 *
 * @param arguments_ - Tool call arguments (can be any JsonValue)
 * @returns Line numbers as string (e.g., "1-10" or "5") or null
 */
export function extractLineNumbers(arguments_: unknown): string | null {
	if (!arguments_ || typeof arguments_ !== "object" || Array.isArray(arguments_)) return null;
	const args = arguments_ as Record<string, unknown>;

	// Check for line or lines
	if ("line" in args) {
		const line = args.line;
		if (typeof line === "number") return String(line);
		if (typeof line === "string") return line;
	}

	if ("lines" in args) {
		const lines = args.lines;
		if (typeof lines === "string") return lines;
		if (Array.isArray(lines) && lines.length > 0) {
			if (lines.length === 1) return String(lines[0]);
			return `${lines[0]}-${lines[lines.length - 1]}`;
		}
	}

	// Check for start_line and end_line
	if ("start_line" in args && "end_line" in args) {
		const start = args.start_line;
		const end = args.end_line;
		if (typeof start === "number" && typeof end === "number") {
			if (start === end) return String(start);
			return `${start}-${end}`;
		}
	}

	// Check for offset and limit (Claude Code format)
	// offset is 0-indexed, so we convert to 1-indexed line numbers
	if ("offset" in args || "limit" in args) {
		const offset = args.offset;
		const limit = args.limit;

		const hasOffset = typeof offset === "number";
		const hasLimit = typeof limit === "number";

		if (hasOffset && hasLimit) {
			// Both offset and limit: start at offset+1, read limit lines
			const startLine = offset + 1;
			const endLine = offset + limit;
			return `${startLine}-${endLine}`;
		}

		if (hasOffset) {
			// Only offset: start at offset+1, read to end
			return `from ${offset + 1}`;
		}

		if (hasLimit) {
			// Only limit: start at line 1, read limit lines
			return `1-${limit}`;
		}
	}

	return null;
}
