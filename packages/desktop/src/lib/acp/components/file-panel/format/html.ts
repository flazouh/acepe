import type { FormatConfig } from "./types.js";

export const htmlConfig: FormatConfig = {
	kind: "html",
	extensions: ["html", "htm"],
	displayOptions: {
		availableModes: ["rendered", "raw"],
		defaultMode: "rendered",
	},
};
