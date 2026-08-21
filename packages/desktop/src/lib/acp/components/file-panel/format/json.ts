import { fromThrowable } from "@acepe/effect-result/fromThrowable";
import * as Effect from "effect/Effect";
import * as Result from "effect/Result";
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
	parseStructured: (content: string): Result.Result<StructuredData, Error> => {
		const parseJson = fromThrowable(
			() => JSON.parse(content) as StructuredCandidate,
			(error) =>
				error instanceof Error
					? new Error(`Invalid JSON: ${error.message}`)
					: new Error("Invalid JSON")
		);
		const parsed = Effect.runSync(Effect.result(parseJson()));
		return parsed.pipe(Result.map(normalizeStructuredData));
	},
};
