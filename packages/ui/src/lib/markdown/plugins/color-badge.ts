import type MarkdownIt from "markdown-it";

import { createColorBadgeHtml } from "../constants.js";

/** Skip color badge when segment after # is all decimal digits (e.g. PR #604). */
function isAllDecimalDigits(hexColor: string): boolean {
	const segment = hexColor.slice(1);
	return /^\d+$/.test(segment);
}

/**
 * Renders hex color badges for #RRGGBB and #RGB patterns.
 */
export function colorBadgePlugin(md: MarkdownIt): void {
	const HEX_COLOR_EXACT = /^#[0-9A-Fa-f]{6}$|^#[0-9A-Fa-f]{3}$/;
	const HEX_COLOR_PATTERN = /(?<!\w)(#[0-9A-Fa-f]{6}|#[0-9A-Fa-f]{3})(?!\w)/g;

	md.core.ruler.push("color_badges", (state) => {
		for (const blockToken of state.tokens) {
			if (blockToken.type !== "inline" || !blockToken.children) {
				continue;
			}

			const newChildren: typeof blockToken.children = [];

			for (const token of blockToken.children) {
				if (token.type === "code_inline" && HEX_COLOR_EXACT.test(token.content)) {
					if (isAllDecimalDigits(token.content)) {
						newChildren.push(token);
					} else {
						const htmlToken = new state.Token("html_inline", "", 0);
						htmlToken.content = createColorBadgeHtml(token.content);
						newChildren.push(htmlToken);
					}
					continue;
				}

				if (token.type !== "text" || !HEX_COLOR_PATTERN.test(token.content)) {
					newChildren.push(token);
					continue;
				}

				HEX_COLOR_PATTERN.lastIndex = 0;

				let lastIndex = 0;
				let match: RegExpExecArray | null;

				while ((match = HEX_COLOR_PATTERN.exec(token.content)) !== null) {
					if (match.index > lastIndex) {
						const textToken = new state.Token("text", "", 0);
						textToken.content = token.content.slice(lastIndex, match.index);
						newChildren.push(textToken);
					}

					if (isAllDecimalDigits(match[0])) {
						const textToken = new state.Token("text", "", 0);
						textToken.content = match[0];
						newChildren.push(textToken);
					} else {
						const htmlToken = new state.Token("html_inline", "", 0);
						htmlToken.content = createColorBadgeHtml(match[0]);
						newChildren.push(htmlToken);
					}
					lastIndex = HEX_COLOR_PATTERN.lastIndex;
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
