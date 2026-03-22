import type MarkdownIt from "markdown-it";

import type { MarkdownPlugin } from "./types.js";

import { sanitizeLanguagesPlugin } from "./sanitize-languages.js";
import { checkboxBadgePlugin } from "./checkbox-badge.js";
import { fenceHandlerPlugin } from "./fence-handler.js";
import { tableWrapperPlugin } from "./table-wrapper.js";
import { colorBadgePlugin } from "./color-badge.js";
import { filePathBadgePlugin } from "./file-path-badge.js";
import { githubBadgePlugin } from "./github-badge.js";

/** Run before Shiki (language sanitization) */
export const PRE_SHIKI_PLUGINS: MarkdownPlugin[] = [
	sanitizeLanguagesPlugin,
];

/** Run after Shiki (fence override, table wrap, inline badges) */
export const POST_SHIKI_PLUGINS: MarkdownPlugin[] = [
	fenceHandlerPlugin,
	tableWrapperPlugin,
	checkboxBadgePlugin,
	colorBadgePlugin,
	filePathBadgePlugin,
	githubBadgePlugin,
];

export function applyPlugins(md: MarkdownIt, plugins: MarkdownPlugin[]): void {
	for (const plugin of plugins) {
		plugin(md);
	}
}
