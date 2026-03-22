import type { SearchMatch, SearchResult } from "../types/search-result.js";

/**
 * Check if a string looks like a valid file path.
 * Returns true if it contains typical path characters and ends with a file extension.
 */
function isValidFilePath(str: string): boolean {
	// Must contain a file extension
	if (!/\.\w+$/.test(str)) return false;

	// Must not contain suspicious patterns (import statement fragments, HTML tags, etc.)
	if (/^["']|["';]+$/.test(str)) return false;
	if (/<|>/.test(str)) return false;
	if (/^import\s|^export\s|^from\s/.test(str)) return false;

	// Should look like a path (contains / or is just a filename)
	return /^[\w./-]+$/.test(str);
}

/**
 * Extract a clean file path from potentially malformed input.
 *
 * Handles patterns like:
 * - `agent-panel-header.svelte";` -> `agent-panel-header.svelte`
 * - `"./src/file.ts"` -> `src/file.ts`
 * - `import { Foo } from "./bar.ts";` -> `bar.ts`
 * - `</div>` -> null (invalid)
 */
function extractFilePath(input: string): string | null {
	if (!input || typeof input !== "string") return null;

	let cleaned = input.trim();

	// Try to extract path from import/export statement
	const importMatch = /from\s+["']([^"']+)["']/.exec(cleaned);
	if (importMatch) {
		cleaned = importMatch[1];
	}

	// Remove leading/trailing quotes
	cleaned = cleaned.replace(/^["']|["']$/g, "");

	// Remove trailing semicolons and quotes
	cleaned = cleaned.replace(/["';]+$/g, "");

	// Remove leading "./" or "../"
	cleaned = cleaned.replace(/^\.\.?\//, "");

	// Extract just the filename if there's garbage around it
	// Look for pattern like: garbage/path/to/file.ext;garbage
	const pathMatch = /([\w./-]+\.\w+)/.exec(cleaned);
	if (pathMatch) {
		cleaned = pathMatch[1];
	}

	// Final validation
	if (!isValidFilePath(cleaned)) {
		return null;
	}

	return cleaned;
}

/**
 * Extract file name from a path.
 */
function getFileName(filePath: string): string {
	return filePath.split("/").pop() ?? filePath;
}

/**
 * Parse a single grep output line.
 *
 * Grep output formats:
 *
 * Multi-file mode (default when searching multiple files):
 * - Match line: "filepath:linenum:content"
 * - Context line: "filepath-linenum-content"
 *
 * Single-file mode (when searching one file, or when -h is used):
 * - Match line: "linenum:content"
 * - Context line: "linenum-content"
 *
 * @param line - The grep output line
 * @param defaultFilePath - File path to use for single-file format
 */
function parseGrepLine(line: string, defaultFilePath?: string): SearchMatch | null {
	if (!line.trim()) {
		return null;
	}

	// Skip separator lines
	if (line === "--") {
		return null;
	}

	// Try multi-file match format: filepath:linenum:content
	// The filepath must look like a path (contain / or end with .ext)
	const multiFileMatch = /^([\w./-]+\.\w+):(\d+):(.*)$/.exec(line);
	if (multiFileMatch) {
		const [, filePath, lineNum, content] = multiFileMatch;
		return {
			filePath,
			fileName: getFileName(filePath),
			lineNumber: parseInt(lineNum, 10),
			content,
			isMatch: true,
		};
	}

	// Try multi-file context format: filepath-linenum-content
	const multiFileContext = /^([\w./-]+\.\w+)-(\d+)-(.*)$/.exec(line);
	if (multiFileContext) {
		const [, filePath, lineNum, content] = multiFileContext;
		return {
			filePath,
			fileName: getFileName(filePath),
			lineNumber: parseInt(lineNum, 10),
			content,
			isMatch: false,
		};
	}

	// Try single-file match format: linenum:content (starts with digits)
	// Works even without defaultFilePath - we'll use a placeholder
	const singleFileMatch = /^(\d+):(.*)$/.exec(line);
	if (singleFileMatch) {
		const [, lineNum, content] = singleFileMatch;
		const filePath = defaultFilePath ?? "";
		return {
			filePath,
			fileName: filePath ? getFileName(filePath) : "",
			lineNumber: parseInt(lineNum, 10),
			content,
			isMatch: true,
		};
	}

	// Try single-file context format: linenum-content (starts with digits followed by hyphen)
	const singleFileContext = /^(\d+)-(.*)$/.exec(line);
	if (singleFileContext) {
		const [, lineNum, content] = singleFileContext;
		const filePath = defaultFilePath ?? "";
		return {
			filePath,
			fileName: filePath ? getFileName(filePath) : "",
			lineNumber: parseInt(lineNum, 10),
			content,
			isMatch: false,
		};
	}

	// No match
	return null;
}

/**
 * Parse grep content output into structured matches.
 *
 * @param content - The raw grep output text
 * @param defaultFilePath - Optional file path for single-file grep output
 */
export function parseGrepContent(content: string, defaultFilePath?: string): SearchMatch[] {
	const lines = content.split("\n");
	const matches: SearchMatch[] = [];

	for (const line of lines) {
		const parsed = parseGrepLine(line, defaultFilePath);
		if (parsed) {
			matches.push(parsed);
		}
	}

	return matches;
}

/**
 * Parse file list from text output, validating each path.
 */
export function parseFileList(text: string): string[] {
	return text
		.split("\n")
		.map((line) => extractFilePath(line))
		.filter((path): path is string => path !== null);
}

/**
 * Parse tool result into a SearchResult structure.
 *
 * Handles both the toolResponse metadata and the content text.
 */
export function parseSearchResult(
	result: unknown,
	toolResponseMeta?: {
		mode?: string;
		numFiles?: number;
		numLines?: number;
		filenames?: string[];
		content?: string;
	},
	/** File path from tool arguments, used for single-file grep */
	searchPath?: string
): SearchResult {
	const mode = toolResponseMeta?.mode;
	const numFiles = toolResponseMeta?.numFiles ?? 0;

	// Content mode - has line numbers and content
	if (mode === "content" && toolResponseMeta?.content) {
		const matches = parseGrepContent(toolResponseMeta.content, searchPath);
		const matchCount = matches.filter((m) => m.isMatch).length;
		return {
			mode: "content",
			numFiles: numFiles || matches.length,
			numMatches: matchCount,
			matches,
			files: [],
		};
	}

	// Files mode - just file paths
	if (mode === "files_with_matches" || mode === "files") {
		const rawFiles = toolResponseMeta?.filenames ?? [];
		const files = rawFiles.map(extractFilePath).filter((f): f is string => f !== null);
		return {
			mode: "files",
			numFiles: files.length || numFiles,
			matches: [],
			files,
		};
	}

	// Count mode
	if (mode === "count") {
		return {
			mode: "count",
			numFiles,
			matches: [],
			files: [],
		};
	}

	// Fallback: try to parse from result directly
	if (Array.isArray(result)) {
		const files = result
			.filter((item): item is string => typeof item === "string")
			.map(extractFilePath)
			.filter((f): f is string => f !== null);
		return {
			mode: "files",
			numFiles: files.length,
			matches: [],
			files,
		};
	}

	if (result && typeof result === "object") {
		const obj = result as Record<string, unknown>;

		// Check for toolResponse structure within result
		if (obj.mode === "content" && typeof obj.content === "string") {
			const matches = parseGrepContent(obj.content, searchPath);
			const matchCount = matches.filter((m) => m.isMatch).length;
			return {
				mode: "content",
				numFiles: (obj.numFiles as number) || matches.length,
				numMatches: matchCount,
				matches,
				files: [],
			};
		}

		if (obj.mode === "files_with_matches" || obj.mode === "files") {
			const rawFiles = (obj.filenames as string[]) ?? [];
			const files = rawFiles.map(extractFilePath).filter((f): f is string => f !== null);
			return {
				mode: "files",
				numFiles: files.length || (obj.numFiles as number) || 0,
				matches: [],
				files,
			};
		}

		// Check for structured result with files array
		const filesArray = obj.files ?? obj.results ?? obj.matches ?? obj.paths;
		if (Array.isArray(filesArray)) {
			const files = filesArray
				.filter((item): item is string => typeof item === "string")
				.map(extractFilePath)
				.filter((f): f is string => f !== null);
			return {
				mode: "files",
				numFiles: files.length,
				matches: [],
				files,
			};
		}

		// Check for text output
		const output = obj.output ?? obj.stdout;
		if (typeof output === "string") {
			// Handle grep-style line output in stdout (e.g. "6:match")
			const grepMatches = parseGrepContent(output, searchPath);
			if (grepMatches.length > 0) {
				return {
					mode: "content",
					numFiles: new Set(grepMatches.map((match) => match.filePath || searchPath || "")).size,
					numMatches: grepMatches.filter((match) => match.isMatch).length,
					matches: grepMatches,
					files: [],
				};
			}

			const files = parseFileList(output);
			if (files.length > 0) {
				return {
					mode: "files",
					numFiles: files.length,
					matches: [],
					files,
				};
			}

			// Fallback: plain grep output with no file/line metadata (e.g. "beta\n").
			// Treat each non-empty line as a content match so the UI does not report
			// "No results found" when command output clearly has matches.
			const plainLines = output
				.split("\n")
				.map((line) => line.trim())
				.filter((line) => line.length > 0);
			if (plainLines.length > 0) {
				const fallbackPath = searchPath ?? "stdout";
				const matches = plainLines.map((line, index) => ({
					filePath: fallbackPath,
					fileName: getFileName(fallbackPath),
					lineNumber: index + 1,
					content: line,
					isMatch: true,
				}));
				return {
					mode: "content",
					numFiles: 1,
					numMatches: matches.length,
					matches,
					files: [],
				};
			}

			return {
				mode: "files",
				numFiles: 0,
				matches: [],
				files: [],
			};
		}
	}

	// String result - check if it looks like grep content output (file:line:content format)
	if (typeof result === "string") {
		// Check if string has grep content format (file:number:content)
		const hasGrepContentFormat = /^[\w./-]+:\d+:/.test(result);

		if (hasGrepContentFormat) {
			const matches = parseGrepContent(result, searchPath);
			const matchCount = matches.filter((m) => m.isMatch).length;
			if (matches.length > 0) {
				return {
					mode: "content",
					numFiles: new Set(matches.map((m) => m.filePath)).size,
					numMatches: matchCount,
					matches,
					files: [],
				};
			}
		}

		// Fall back to file list parsing
		const files = parseFileList(result);
		if (files.length > 0) {
			return {
				mode: "files",
				numFiles: files.length,
				matches: [],
				files,
			};
		}

		const plainLines = result
			.split("\n")
			.map((line) => line.trim())
			.filter((line) => line.length > 0);
		if (plainLines.length > 0) {
			const fallbackPath = searchPath ?? "stdout";
			const matches = plainLines.map((line, index) => ({
				filePath: fallbackPath,
				fileName: getFileName(fallbackPath),
				lineNumber: index + 1,
				content: line,
				isMatch: true,
			}));
			return {
				mode: "content",
				numFiles: 1,
				numMatches: matches.length,
				matches,
				files: [],
			};
		}

		return {
			mode: "files",
			numFiles: 0,
			matches: [],
			files: [],
		};
	}

	// Empty result
	return {
		mode: "files",
		numFiles: 0,
		matches: [],
		files: [],
	};
}

/**
 * Highlight matches in content based on a search pattern.
 *
 * Returns an array of segments with isMatch flag.
 */
export function highlightMatches(
	content: string,
	pattern: string | null
): Array<{ text: string; isMatch: boolean }> {
	if (!pattern || !content) {
		return [{ text: content, isMatch: false }];
	}

	try {
		// Create a case-insensitive regex from the pattern
		const regex = new RegExp(`(${escapeRegex(pattern)})`, "gi");
		const segments: Array<{ text: string; isMatch: boolean }> = [];
		let lastIndex = 0;

		for (const match of content.matchAll(regex)) {
			const matchStart = match.index ?? 0;

			// Add text before the match
			if (matchStart > lastIndex) {
				segments.push({
					text: content.slice(lastIndex, matchStart),
					isMatch: false,
				});
			}

			// Add the match
			segments.push({
				text: match[0],
				isMatch: true,
			});

			lastIndex = matchStart + match[0].length;
		}

		// Add remaining text
		if (lastIndex < content.length) {
			segments.push({
				text: content.slice(lastIndex),
				isMatch: false,
			});
		}

		return segments.length > 0 ? segments : [{ text: content, isMatch: false }];
	} catch {
		// If regex is invalid, return unhighlighted content
		return [{ text: content, isMatch: false }];
	}
}

/**
 * Escape special regex characters in a string.
 */
function escapeRegex(str: string): string {
	return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
