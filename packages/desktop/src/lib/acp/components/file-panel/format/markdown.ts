import { MARKDOWN_EXTENSIONS } from "../../tool-calls/tool-call-edit/constants/markdown-extensions.js";
import type { FormatConfig } from "./types.js";

const MARKDOWN_EXTENSION_SET = new Set<string>(MARKDOWN_EXTENSIONS);

export const markdownConfig: FormatConfig = {
	kind: "markdown",
	matchFile: (_, extension) => MARKDOWN_EXTENSION_SET.has(extension),
	displayOptions: {
		availableModes: ["rendered", "raw"],
		defaultMode: "rendered",
	},
};
