import { Result } from "neverthrow";
import { normalizeStructuredData } from "./parsers/structured.js";
import type { FormatConfig, StructuredData } from "./types.js";

type StructuredCandidate =
	| (string | number | boolean | null)
	| Date
	| StructuredCandidate[]
	| {
			[key: string]: StructuredCandidate;
	  };

export const jsonConfig: FormatConfig = {
	kind: "json",
	extensions: ["json"],
	displayOptions: {
		availableModes: ["structured", "raw"],
		defaultMode: "structured",
	},
	parseStructured: (content: string): Result<StructuredData, Error> => {
		const parsed = Result.fromThrowable(
			() => JSON.parse(content) as StructuredCandidate,
			(error) =>
				error instanceof Error
					? new Error(`Invalid JSON: ${error.message}`)
					: new Error("Invalid JSON")
		)();

		return parsed.map(normalizeStructuredData);
	},
};
