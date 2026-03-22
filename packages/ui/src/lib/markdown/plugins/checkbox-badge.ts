import type MarkdownIt from "markdown-it";

import { createCompletedBadgeHtml, createPendingBadgeHtml } from "../constants.js";

/**
 * Renders checkbox-style badges for [x] (completed) and [ ] (pending) patterns.
 */
export function checkboxBadgePlugin(md: MarkdownIt): void {
	const CHECKBOX_PATTERN = /\[(x|X| )\]/g;

	md.core.ruler.push("checkbox_badges", (state) => {
		for (const blockToken of state.tokens) {
			if (blockToken.type !== "inline" || !blockToken.children) {
				continue;
			}

			const newChildren: typeof blockToken.children = [];

			for (const token of blockToken.children) {
				if (token.type !== "text" || !CHECKBOX_PATTERN.test(token.content)) {
					newChildren.push(token);
					continue;
				}

				CHECKBOX_PATTERN.lastIndex = 0;

				let lastIndex = 0;
				let match: RegExpExecArray | null;

				while ((match = CHECKBOX_PATTERN.exec(token.content)) !== null) {
					if (match.index > lastIndex) {
						const textToken = new state.Token("text", "", 0);
						textToken.content = token.content.slice(lastIndex, match.index);
						newChildren.push(textToken);
					}

					const isChecked = match[1].toLowerCase() === "x";
					const htmlToken = new state.Token("html_inline", "", 0);
					htmlToken.content = isChecked
						? createCompletedBadgeHtml("Done")
						: createPendingBadgeHtml("Pending");

					newChildren.push(htmlToken);
					lastIndex = CHECKBOX_PATTERN.lastIndex;
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
