import { Result } from "neverthrow";
import { parseJsonLines } from "./parsers/ndjson.js";
import type { FormatConfig, StructuredData } from "./types.js";

export const ndjsonConfig: FormatConfig = {
	kind: "ndjson",
	extensions: ["ndjson", "jsonl"],
	displayOptions: {
		availableModes: ["structured", "raw"],
		defaultMode: "structured",
	},
	parseStructured: (content: string): Result<StructuredData, Error> =>
		Result.fromThrowable(
			() => parseJsonLines(content),
			(error) =>
				error instanceof Error
					? new Error(`Invalid NDJSON: ${error.message}`)
					: new Error("Invalid NDJSON")
		)(),
};
