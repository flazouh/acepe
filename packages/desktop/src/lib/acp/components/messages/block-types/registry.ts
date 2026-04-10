/**
 * Block type registry. Add new block types by importing and including their config here.
 * Each config provides regex and parse for extracting placeholders from rendered HTML.
 */

import { mermaidBlockConfig } from "./mermaid.js";
import { pierreFileBlockConfig } from "./pierre-file.js";
import type { BlockParseConfig, ContentBlock } from "./types.js";

/**
 * All registered block parse configs. Order does not affect parsing (matches are merged and sorted by index).
 * Note: file_path_badge and github_badge are NOT here — they use inline <span> placeholders
 * and are mounted by mountFileBadges / mountGitHubBadges so badges stay inside parent elements (li, p, etc.).
 */
export const BLOCK_PARSE_CONFIGS: BlockParseConfig[] = [mermaidBlockConfig, pierreFileBlockConfig];

/**
 * Get config for a block type, or undefined if not found.
 */
export function getBlockParseConfig(type: ContentBlock["type"]): BlockParseConfig | undefined {
	return BLOCK_PARSE_CONFIGS.find((c) => c.type === type);
}
