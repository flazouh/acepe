import type { FormatConfig } from "./types.js";

export const diffConfig: FormatConfig = {
	kind: "diff",
	extensions: ["diff", "patch"],
	displayOptions: {
		availableModes: ["rendered", "raw"],
		defaultMode: "rendered",
	},
};
