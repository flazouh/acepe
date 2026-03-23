import type { FormatConfig } from "./types.js";

export const mdxConfig: FormatConfig = {
	kind: "mdx",
	extensions: ["mdx"],
	displayOptions: {
		availableModes: ["rendered", "raw"],
		defaultMode: "rendered",
	},
};
