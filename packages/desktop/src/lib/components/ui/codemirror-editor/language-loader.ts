/**
 * Dynamic language loading for CodeMirror 6 using @codemirror/language-data.
 * Uses neverthrow for type-safe error handling.
 */

import type { LanguageDescription, LanguageSupport } from "@codemirror/language";
import { languages } from "@codemirror/language-data";
import { svelte as svelteLanguageSupport } from "@replit/codemirror-lang-svelte";
import { okAsync, ResultAsync } from "neverthrow";

/**
 * Load a CodeMirror language extension by name.
 * Returns null for unsupported languages (will fall back to plaintext).
 */
export function loadLanguageByName(name: string): ResultAsync<LanguageSupport | null, Error> {
	if (!name || name === "plaintext") {
		return okAsync(null);
	}

	// Map Monaco language names to CodeMirror equivalents where they differ
	const mappedName = mapLanguageName(name);

	// @codemirror/language-data does not include Svelte support.
	// Use the dedicated Svelte language package when requested.
	if (mappedName.toLowerCase() === "svelte") {
		return okAsync(svelteLanguageSupport());
	}

	const desc = findLanguageDescription(mappedName);

	if (!desc) {
		// Language not found - return null to use plaintext fallback
		return okAsync(null);
	}

	return ResultAsync.fromPromise(
		desc.load(),
		(error) => new Error(`Failed to load language ${name}: ${error}`)
	);
}

/**
 * Load a CodeMirror language extension by filename.
 * Returns null for unsupported file types (will fall back to plaintext).
 */
export function loadLanguageByFilename(
	filename: string
): ResultAsync<LanguageSupport | null, Error> {
	const desc = languages.find((lang) => {
		// Check extensions
		if (lang.extensions?.some((ext) => filename.endsWith(ext))) {
			return true;
		}
		// Check filename patterns
		if (lang.filename?.test(filename)) {
			return true;
		}
		return false;
	});

	if (!desc) {
		return okAsync(null);
	}

	return ResultAsync.fromPromise(
		desc.load(),
		(error) => new Error(`Failed to load language for ${filename}: ${error}`)
	);
}

/**
 * Find a language description by name, checking aliases and case variations.
 */
function findLanguageDescription(name: string): LanguageDescription | undefined {
	const lowerName = name.toLowerCase();

	return languages.find((lang) => {
		// Check main name
		if (lang.name.toLowerCase() === lowerName) {
			return true;
		}
		// Check aliases
		if (lang.alias?.some((alias) => alias.toLowerCase() === lowerName)) {
			return true;
		}
		return false;
	});
}

/**
 * Map Monaco language names to CodeMirror equivalents.
 * Most names are the same, but some differ.
 */
function mapLanguageName(monacoName: string): string {
	const mapping: Record<string, string> = {
		// Monaco uses different names for some languages
		shell: "Shell",
		bat: "PowerShell", // Closest match for batch files
		dotenv: "Shell", // .env files can use shell highlighting
		jsonc: "JSON", // JSON with comments
		gitignore: "Shell", // Basic highlighting
		gitattributes: "Shell", // Basic highlighting
		makefile: "Shell", // Shell-like syntax
		dockerfile: "Dockerfile",
		ini: "TOML", // Similar syntax
		conf: "TOML",
		cfg: "TOML",
		svelte: "Svelte",
		vue: "Vue",
	};

	return mapping[monacoName.toLowerCase()] ?? monacoName;
}

// Extension to language mapping (for getLanguageFromFilename compatibility)
const EXTENSION_MAP: Record<string, string> = {
	// JavaScript/TypeScript
	".js": "javascript",
	".mjs": "javascript",
	".cjs": "javascript",
	".jsx": "jsx",
	".ts": "typescript",
	".tsx": "tsx",
	".mts": "typescript",
	".cts": "typescript",

	// Web
	".html": "html",
	".htm": "html",
	".css": "css",
	".scss": "scss",
	".sass": "sass",
	".less": "less",

	// Data formats
	".json": "json",
	".jsonc": "json",
	".yaml": "yaml",
	".yml": "yaml",
	".toml": "toml",
	".xml": "xml",
	".svg": "xml",

	// Markdown
	".md": "markdown",
	".mdx": "markdown",
	".markdown": "markdown",

	// Systems
	".rs": "rust",
	".go": "go",
	".c": "c",
	".h": "c",
	".cpp": "cpp",
	".cc": "cpp",
	".cxx": "cpp",
	".hpp": "cpp",
	".hxx": "cpp",
	".java": "java",
	".swift": "swift",
	".kt": "kotlin",
	".kts": "kotlin",

	// Scripting
	".py": "python",
	".rb": "ruby",
	".php": "php",
	".lua": "lua",
	".pl": "perl",

	// Shell
	".sh": "shell",
	".bash": "shell",
	".zsh": "shell",
	".fish": "shell",
	".ps1": "powershell",
	".bat": "shell",
	".cmd": "shell",

	// Config
	".ini": "toml",
	".conf": "toml",
	".cfg": "toml",
	".env": "shell",

	// Web frameworks
	".svelte": "svelte",
	".vue": "vue",

	// SQL
	".sql": "sql",

	// GraphQL - not in @codemirror/language-data, use plaintext
	".graphql": "plaintext",
	".gql": "plaintext",

	// Docker
	".dockerfile": "dockerfile",

	// Other
	".diff": "diff",
	".patch": "diff",
	".log": "plaintext",
	".txt": "plaintext",
};

// Special filenames that don't have extensions
const FILENAME_MAP: Record<string, string> = {
	Dockerfile: "dockerfile",
	Makefile: "shell",
	Jenkinsfile: "groovy",
	Vagrantfile: "ruby",
	Gemfile: "ruby",
	Rakefile: "ruby",
	".gitignore": "shell",
	".gitattributes": "shell",
	".editorconfig": "toml",
	".prettierrc": "json",
	".eslintrc": "json",
	".babelrc": "json",
	"package.json": "json",
	"tsconfig.json": "json",
	"jsconfig.json": "json",
	"Cargo.toml": "toml",
	"pyproject.toml": "toml",
};

/**
 * Detect CodeMirror language from a filename or filepath.
 * Compatible with the Monaco version for drop-in replacement.
 */
export function getLanguageFromFilename(filename: string): string {
	// Extract just the filename from a path
	const basename = filename.split("/").pop() ?? filename;

	// Check special filenames first
	if (FILENAME_MAP[basename]) {
		return FILENAME_MAP[basename];
	}

	// Get extension (including the dot)
	const lastDotIndex = basename.lastIndexOf(".");
	if (lastDotIndex === -1) {
		return "plaintext";
	}

	const extension = basename.slice(lastDotIndex).toLowerCase();

	return EXTENSION_MAP[extension] ?? "plaintext";
}
