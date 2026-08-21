import * as Result from "effect/Result";
import { parseContentToStructured } from "./parsers/dockerfile.js";
import type { FormatConfig, StructuredData } from "./types.js";

export const dockerfileConfig: FormatConfig = {
	kind: "dockerfile",
	matchFile: (fileName) => fileName === "dockerfile" || fileName.endsWith(".dockerfile"),
	displayOptions: {
		availableModes: ["structured", "raw"],
		defaultMode: "structured",
	},
	parseStructured: (content: string): Result.Result<StructuredData, Error> =>
		Result.succeed(parseContentToStructured(content)),
};
