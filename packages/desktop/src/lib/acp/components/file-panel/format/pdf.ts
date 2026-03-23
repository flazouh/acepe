import type { FormatConfig } from "./types.js";

export const pdfConfig: FormatConfig = {
	kind: "pdf",
	extensions: ["pdf"],
	displayOptions: {
		availableModes: ["rendered"],
		defaultMode: "rendered",
	},
};
