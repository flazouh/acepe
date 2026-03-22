import type { FormatConfig } from "./types.js";

export const sqlConfig: FormatConfig = {
	kind: "sql",
	extensions: ["sql"],
	displayOptions: {
		availableModes: ["rendered", "raw"],
		defaultMode: "rendered",
	},
};
