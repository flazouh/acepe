import { decodeInlineTextTokenValue, truncateHoverPreview } from "./inline-token-preview.js";
import { getInlineTokenType, getInlineTokenValue } from "./inline-composer-dom.js";

export function applyInlineTokenHoverTitles(editor: HTMLElement): void {
	const tokenNodes = editor.querySelectorAll("[data-inline-token-type][data-inline-token-value]");
	for (const node of tokenNodes) {
		const tokenType = getInlineTokenType(node);
		const tokenValue = getInlineTokenValue(node);
		if (!tokenType || !tokenValue) {
			node.removeAttribute("title");
			continue;
		}

		if (tokenType === "skill") {
			node.setAttribute("title", tokenValue.startsWith("/") ? tokenValue : `/${tokenValue}`);
			continue;
		}

		if (tokenType === "text_ref") {
		// No native title; text references use the custom preview overlay.
		node.removeAttribute("title");
		continue;
	}

	if (tokenType === "image_ref") {
		node.removeAttribute("title");
		continue;
	}

		if (tokenType === "text") {
			const decoded = decodeInlineTextTokenValue(tokenValue);
			node.setAttribute("title", truncateHoverPreview(decoded ?? "Pasted text"));
			continue;
		}

		node.removeAttribute("title");
	}
}
