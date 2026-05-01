/**
 * Maximum height for the diff view container in pixels.
 *
 * When content exceeds this height, vertical scrolling is enabled.
 */
export const DIFF_VIEW_MAX_HEIGHT = 384; // 96 * 4 (max-h-96 in Tailwind)

/**
 * Supported programming languages for syntax highlighting.
 *
 * These languages are supported by the Shiki highlighter used in the edit tool.
 */
export const SUPPORTED_LANGUAGES = [
	"typescript",
	"javascript",
	"python",
	"html",
	"css",
	"json",
	"markdown",
	"rust",
	"go",
	"java",
	"cpp",
	"c",
	"php",
	"ruby",
	"swift",
	"text",
	"bash",
	"sh",
	"shell",
	"svelte",
	"tsx",
	"jsx",
	"vue",
	"yaml",
	"toml",
	"sql",
	"graphql",
] as const;

/**
 * Default language to use when file extension cannot be determined.
 */
export const DEFAULT_LANGUAGE = "text" as const;

/**
 * Map file extensions to Shiki language identifiers.
 *
 * Some file extensions don't match the Shiki language name directly,
 * so we need this mapping.
 */
export const EXTENSION_TO_LANGUAGE: Record<string, string> = {
	ts: "typescript",
	tsx: "tsx",
	js: "javascript",
	jsx: "jsx",
	mjs: "javascript",
	cjs: "javascript",
	mts: "typescript",
	cts: "typescript",
	py: "python",
	rb: "ruby",
	rs: "rust",
	yml: "yaml",
	md: "markdown",
	htm: "html",
	svelte: "svelte",
	vue: "vue",
	gql: "graphql",
};
