import { Result } from "neverthrow";
import { parse as parseYaml } from "yaml";
import { normalizeStructuredData } from "./parsers/structured.js";
import type { FormatConfig, StructuredData } from "./types.js";

type StructuredCandidate =
	| (string | number | boolean | null)
	| Date
	| StructuredCandidate[]
	| {
			[key: string]: StructuredCandidate;
	  };

export const yamlConfig: FormatConfig = {
	kind: "yaml",
	extensions: ["yml", "yaml"],
	displayOptions: {
		availableModes: ["structured", "raw"],
		defaultMode: "structured",
	},
	parseStructured: (content: string): Result<StructuredData, Error> => {
		const parsed = Result.fromThrowable(
			() => parseYaml(content) as StructuredCandidate,
			(error) =>
				error instanceof Error
					? new Error(`Invalid YAML: ${error.message}`)
					: new Error("Invalid YAML")
		)();

		return parsed.map(normalizeStructuredData);
	},
};
