/**
 * Content block types for markdown placeholder parsing.
 * Each block type corresponds to a placeholder emitted by the markdown renderer.
 */

import type { GitHubReference } from "../../../constants/github-badge-html.js";

/**
 * Content block representing either HTML or a special placeholder block.
 * HTML blocks pass through; placeholder blocks are rendered with Svelte components.
 */
export type ContentBlock =
	| { type: "html"; content: string }
	| { type: "mermaid"; code: string }
	| { type: "pierre_file"; code: string; lang: string | null }
	| { type: "github_badge"; ref: GitHubReference }
	| {
			type: "file_path_badge";
			filePath: string;
			locationSuffix: string;
			linesAdded?: number;
			linesRemoved?: number;
	  };

export type NonHtmlBlock = Exclude<ContentBlock, { type: "html" }>;

/**
 * Parse config for a single block type.
 * Used by the registry to extract placeholders from rendered HTML.
 */
export type BlockParseConfig<T extends NonHtmlBlock["type"] = NonHtmlBlock["type"]> = {
	type: T;
	regex: RegExp;
	parse: (match: RegExpMatchArray) => (ContentBlock & { type: T }) | null;
};
