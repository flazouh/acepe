import type MarkdownIt from "markdown-it";
import type StateCore from "markdown-it/lib/rules_core/state_core.mjs";
import type Token from "markdown-it/lib/token.mjs";
import { extensionToIcon } from "../../file-icon/extension-map.js";

function escapeRegExp(text: string): string {
	return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const KNOWN_EXTENSION_GROUP = `(?:${Object.keys(extensionToIcon)
	.map(escapeRegExp)
	.join("|")})`;

const FILE_REFERENCE_WITH_LOCATION =
	/^(?<path>.+?):(?<line>\d+)(?::(?<column>\d+))?$/;

/** Matches backtick-wrapped paths with at least one `/` separator + known extension. */
const PATH_WITH_DIR =
	new RegExp(
		`^\\/?(?:[^/\\s]+\\/)+[^/\\s]+\\.${KNOWN_EXTENSION_GROUP}(?::\\d+(?::\\d+)?)?$`
	);

/**
 * Matches backtick-wrapped bare filenames (no `/`).
 * Heuristic: extension must be in KNOWN_EXTENSIONS.
 * Rejects unknown extensions (input.name), numeric extensions (v1.0),
 * and PascalCase after dot (React.Component).
 */
const BARE_FILENAME = new RegExp(
	`^[^/\\s]*\\.${KNOWN_EXTENSION_GROUP}(?::\\d+(?::\\d+)?)?$`
);

/** Matches file paths in plain text (requires `/` separator + known extension). */
const PATH_IN_TEXT = new RegExp(
	`(?<!\\S)(\\/?(?:[^/\\s]+\\/)+[^/\\s]+\\.${KNOWN_EXTENSION_GROUP}(?::\\d+(?::\\d+)?)?)(?!\\S)`,
	"g"
);

// ---------------------------------------------------------------------------
// Predicates
// ---------------------------------------------------------------------------

function isFilePathInCode(content: string): boolean {
	return PATH_WITH_DIR.test(content) || BARE_FILENAME.test(content);
}

/** Extract a local file ref from a markdown link href, or null if it's a URL. */
function extractLocalFileRef(href: string): string | null {
	if (/^(?:https?:|mailto:|#)/.test(href)) return null;
	const [path, fragment] = href.split("#", 2);
	if (!path || !isFilePathInCode(path)) return null;
	const lineMatch = fragment?.match(/^L(\d+)/);
	return lineMatch ? `${path}:${lineMatch[1]}` : path;
}

// ---------------------------------------------------------------------------
// Token helpers
// ---------------------------------------------------------------------------

function parseFilePathReference(fileReference: string): {
	filePath: string;
	locationSuffix: string;
} {
	const match = FILE_REFERENCE_WITH_LOCATION.exec(fileReference);
	if (!match?.groups?.path || !match.groups.line) {
		return { filePath: fileReference, locationSuffix: "" };
	}
	const { path, line, column } = match.groups;
	const locationSuffix = column ? `:${line}:${column}` : `:${line}`;
	return { filePath: path, locationSuffix };
}

function createPlaceholderToken(state: StateCore, fileReference: string): Token {
	const { filePath, locationSuffix } = parseFilePathReference(fileReference);
	const encoded = encodeURIComponent(JSON.stringify({ filePath, locationSuffix }));
	const token = new state.Token("html_inline", "", 0);
	token.content = `<span class="file-path-badge-placeholder" data-reveal-skip data-file-ref="${encoded}"></span>`;
	return token;
}

function splitTextByFilePaths(state: StateCore, text: string): Token[] {
	PATH_IN_TEXT.lastIndex = 0;
	if (!PATH_IN_TEXT.test(text)) {
		const token = new state.Token("text", "", 0);
		token.content = text;
		return [token];
	}

	PATH_IN_TEXT.lastIndex = 0;
	const tokens: Token[] = [];
	let lastIndex = 0;
	let match: RegExpExecArray | null;

	while ((match = PATH_IN_TEXT.exec(text)) !== null) {
		if (match.index > lastIndex) {
			const t = new state.Token("text", "", 0);
			t.content = text.slice(lastIndex, match.index);
			tokens.push(t);
		}
		tokens.push(createPlaceholderToken(state, match[1]));
		lastIndex = PATH_IN_TEXT.lastIndex;
	}

	if (lastIndex < text.length) {
		const t = new state.Token("text", "", 0);
		t.content = text.slice(lastIndex);
		tokens.push(t);
	}

	return tokens;
}

// ---------------------------------------------------------------------------
// Plugin
// ---------------------------------------------------------------------------

/**
 * Context-aware token transformer that replaces file path references with
 * placeholder spans. Tracks `link_open` / `link_close` nesting to avoid
 * replacing paths that are already inside markdown links.
 *
 * Handles both plain text paths (with `/` separator) and backtick-wrapped
 * filenames (bare or with path).
 */
export function filePathBadgePlugin(md: MarkdownIt): void {
	md.core.ruler.push("file_path_badges", (state) => {
		for (const blockToken of state.tokens) {
			if (blockToken.type !== "inline" || !blockToken.children) continue;

			let insideLink = false;
			let replacingLink = false;
			const result: Token[] = [];

			for (const token of blockToken.children) {
				if (replacingLink) {
					if (token.type === "link_close") {
						replacingLink = false;
					}
					continue;
				}

				if (token.type === "link_open") {
					const href = token.attrGet("href");
					const fileRef = href ? extractLocalFileRef(href) : null;
					if (fileRef) {
						result.push(createPlaceholderToken(state, fileRef));
						replacingLink = true;
						continue;
					}
					insideLink = true;
				}

				if (token.type === "link_close") {
					insideLink = false;
				}

				if (insideLink) {
					result.push(token);
					continue;
				}

				if (token.type === "code_inline" && isFilePathInCode(token.content)) {
					result.push(createPlaceholderToken(state, token.content));
					continue;
				}

				if (token.type === "text") {
					result.push(...splitTextByFilePaths(state, token.content));
					continue;
				}

				result.push(token);
			}

			blockToken.children = result;
		}
	});
}
