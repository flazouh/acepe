import type { FormatConfig } from "./types.js";

export const logConfig: FormatConfig = {
	kind: "log",
	extensions: ["log"],
	displayOptions: {
		availableModes: ["rendered", "raw"],
		defaultMode: "rendered",
	},
};
