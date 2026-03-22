import type { BlockParseConfig } from "./types.js";

export const pierreFileBlockConfig: BlockParseConfig<"pierre_file"> = {
	type: "pierre_file",
	regex:
		/<div class="pierre-file-placeholder" data-pierre-code="([^"]+)" data-pierre-lang="([^"]*)"><\/div>/g,
	parse: (match) => ({
		type: "pierre_file",
		code: decodeURIComponent(match[1]),
		lang: match[2] ? decodeURIComponent(match[2]) : null,
	}),
};
