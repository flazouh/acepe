import * as Result from "effect/Result";

import type { FormatConfig, StructuredData } from "./types.js";

export const otherConfig: FormatConfig = {
	kind: "other",
	displayOptions: {
		availableModes: ["raw"],
		defaultMode: "raw",
	},
	parseStructured: (content: string): Result.Result<StructuredData, Error> =>
		Result.succeed({ raw: content }),
};
