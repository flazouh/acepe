import type { FormatConfig } from "./types.js";

export const csvConfig: FormatConfig = {
	kind: "csv",
	extensions: ["csv"],
	displayOptions: {
		availableModes: ["table", "raw"],
		defaultMode: "table",
	},
};
