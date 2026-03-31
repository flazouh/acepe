import type MarkdownIt from "markdown-it";

import { parseFilePathReference } from "../../constants/todo-badge-html.js";

function createFilePathBadgePlaceholder(fileReference: string): string {
	const { filePath, locationSuffix } = parseFilePathReference(fileReference);
	const encoded = encodeURIComponent(JSON.stringify({ filePath, locationSuffix }));
	return `<span class="file-path-badge-placeholder" data-reveal-skip data-file-ref="${encoded}"></span>`;
}

/**
 * Renders file path badges for Unix/macOS file paths (absolute and relative).
 * Transforms paths like /Users/example/file.csv or packages/desktop/src/file.ts into clickable badges.
 * Handles both plain text and inline code (backtick-wrapped) paths.
 *
 * Pattern examples:
 * - /Users/example/Documents/file.csv → clickable file badge
 * - packages/desktop/src/lib/file.ts → clickable file badge
 * - `/path/to/file.txt` → clickable file badge
 */
export function filePathBadgePlugin(md: MarkdownIt): void {
	const FILE_PATH_REFERENCE_EXACT = /^\/?(?:[^/\s]+\/)+[^/\s]+\.[a-zA-Z0-9]+(?::\d+(?::\d+)?)?$/;
	const FILE_PATH_REFERENCE_PATTERN =
		/(?<!\S)(\/?(?:[^/\s]+\/)+[^/\s]+\.(?:csv|txt|json|md|ts|tsx|js|jsx|svelte|vue|html|css|scss|py|rs|go|java|rb|php|yaml|yml|toml|xml|sql|sh|bash|zsh|env|gitignore|log|conf|config|ini)(?::\d+(?::\d+)?)?)(?!\S)/g;

	md.core.ruler.push("file_path_badges", (state) => {
		for (const blockToken of state.tokens) {
			if (blockToken.type !== "inline" || !blockToken.children) {
				continue;
			}

			const newChildren: typeof blockToken.children = [];

			for (const token of blockToken.children) {
				if (token.type === "code_inline" && FILE_PATH_REFERENCE_EXACT.test(token.content)) {
					const htmlToken = new state.Token("html_inline", "", 0);
					htmlToken.content = createFilePathBadgePlaceholder(token.content);
					newChildren.push(htmlToken);
					continue;
				}

				if (token.type !== "text" || !FILE_PATH_REFERENCE_PATTERN.test(token.content)) {
					newChildren.push(token);
					continue;
				}

				FILE_PATH_REFERENCE_PATTERN.lastIndex = 0;

				let lastIndex = 0;
				let match: RegExpExecArray | null;

				// biome-ignore lint/suspicious/noAssignInExpressions: standard regex exec loop
				while ((match = FILE_PATH_REFERENCE_PATTERN.exec(token.content)) !== null) {
					if (match.index > lastIndex) {
						const textToken = new state.Token("text", "", 0);
						textToken.content = token.content.slice(lastIndex, match.index);
						newChildren.push(textToken);
					}

					const filePath = match[1];
					const htmlToken = new state.Token("html_inline", "", 0);
					htmlToken.content = createFilePathBadgePlaceholder(filePath);

					newChildren.push(htmlToken);
					lastIndex = FILE_PATH_REFERENCE_PATTERN.lastIndex;
				}

				if (lastIndex < token.content.length) {
					const textToken = new state.Token("text", "", 0);
					textToken.content = token.content.slice(lastIndex);
					newChildren.push(textToken);
				}
			}

			blockToken.children = newChildren;
		}
	});
}
