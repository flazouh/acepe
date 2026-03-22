/**
 * Parses rendered markdown HTML and extracts placeholder blocks into typed content blocks.
 * Uses the block type registry - add new types by registering in block-types/registry.ts.
 */

import type { ContentBlock } from "../block-types/types.js";

export type { ContentBlock } from "../block-types/types.js";

import { BLOCK_PARSE_CONFIGS } from "../block-types/registry.js";

type PlaceholderMatch = {
	matchIndex: number;
	matchLength: number;
	block: ContentBlock;
};

/**
 * Parses HTML content and extracts placeholder blocks (mermaid, pierre file, GitHub badge, etc.)
 * into separate blocks. Returns an array of content blocks that can be rendered with Svelte components.
 */
export function parseContentBlocks(html: string): ContentBlock[] {
	const blocks: ContentBlock[] = [];
	let lastIndex = 0;

	const placeholderMatches: PlaceholderMatch[] = [];

	for (const config of BLOCK_PARSE_CONFIGS) {
		// Use fresh regex to avoid stateful lastIndex across parses
		const regex = new RegExp(config.regex.source, config.regex.flags);
		for (const match of html.matchAll(regex)) {
			const block = config.parse(match);
			if (block) {
				placeholderMatches.push({
					matchIndex: match.index ?? 0,
					matchLength: match[0].length,
					block,
				});
			}
		}
	}

	placeholderMatches.sort((a, b) => a.matchIndex - b.matchIndex);

	for (const placeholder of placeholderMatches) {
		const matchIndex = placeholder.matchIndex;

		if (matchIndex > lastIndex) {
			const htmlContent = html.slice(lastIndex, matchIndex);
			if (htmlContent.trim()) {
				blocks.push({ type: "html", content: htmlContent });
			}
		}

		blocks.push(placeholder.block);
		lastIndex = matchIndex + placeholder.matchLength;
	}

	if (lastIndex < html.length) {
		const htmlContent = html.slice(lastIndex);
		if (htmlContent.trim()) {
			blocks.push({ type: "html", content: htmlContent });
		}
	}

	if (blocks.length === 0 && html.trim()) {
		blocks.push({ type: "html", content: html });
	}

	return blocks;
}
