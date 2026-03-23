import type { BundledLanguage } from "shiki";
import type MarkdownIt from "markdown-it";

import { SUPPORTED_LANGUAGES } from "../constants.js";

const SHIKI_LANGUAGES = SUPPORTED_LANGUAGES.filter((lang) => lang !== "text") as BundledLanguage[];
const SHIKI_LANGUAGES_SET = new Set<string>(SHIKI_LANGUAGES);

/**
 * Sanitizes code block languages to prevent Shiki errors.
 * Replaces unsupported languages with an empty string.
 * Run before Shiki processes fences.
 */
export function sanitizeLanguagesPlugin(md: MarkdownIt): void {
	md.core.ruler.push("sanitize_fence_languages", (state) => {
		for (const token of state.tokens) {
			if (token.type === "fence") {
				const lang = token.info.trim().split(/\s+/)[0];
				if (lang === "mermaid") {
					continue;
				}
				if (lang && !SHIKI_LANGUAGES_SET.has(lang)) {
					token.info = "";
				}
			}
		}
	});
}
