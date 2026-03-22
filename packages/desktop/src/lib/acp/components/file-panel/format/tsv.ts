import type { FormatConfig } from "./types.js";

export const tsvConfig: FormatConfig = {
	kind: "tsv",
	extensions: ["tsv"],
	displayOptions: {
		availableModes: ["table", "raw"],
		defaultMode: "table",
	},
};
