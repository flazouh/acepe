import type { BlockParseConfig } from "./types.js";

export const mermaidBlockConfig: BlockParseConfig<"mermaid"> = {
	type: "mermaid",
	regex: /<div class="mermaid-placeholder" data-mermaid-code="([^"]+)"><\/div>/g,
	parse: (match) => ({
		type: "mermaid",
		code: decodeURIComponent(match[1]),
	}),
};
