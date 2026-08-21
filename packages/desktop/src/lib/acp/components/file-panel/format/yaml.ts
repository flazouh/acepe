import { fromThrowable } from "@acepe/effect-result/fromThrowable";
import * as Effect from "effect/Effect";
import * as Result from "effect/Result";
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
	parseStructured: (content: string): Result.Result<StructuredData, Error> => {
		const parseYamlValue = fromThrowable(
			() => parseYaml(content) as StructuredCandidate,
			(error) =>
				error instanceof Error
					? new Error(`Invalid YAML: ${error.message}`)
					: new Error("Invalid YAML")
		);
		const parsed = Effect.runSync(Effect.result(parseYamlValue()));
		return parsed.pipe(Result.map(normalizeStructuredData));
	},
};
