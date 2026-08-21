import * as Result from "effect/Result";
import { parseContentToStructured } from "./parsers/gitignore.js";
import type { FormatConfig, StructuredData } from "./types.js";

export const gitignoreConfig: FormatConfig = {
	kind: "gitignore",
	matchFile: (fileName) => fileName === ".gitignore" || fileName.endsWith(".gitignore"),
	displayOptions: {
		availableModes: ["structured", "raw"],
		defaultMode: "structured",
	},
	parseStructured: (content: string): Result.Result<StructuredData, Error> =>
		Result.succeed(parseContentToStructured(content)),
};
