import { ok, type Result } from "neverthrow";

import type { FormatConfig, StructuredData } from "./types.js";

export const otherConfig: FormatConfig = {
	kind: "other",
	displayOptions: {
		availableModes: ["raw"],
		defaultMode: "raw",
	},
	parseStructured: (content: string): Result<StructuredData, Error> => ok({ raw: content }),
};
