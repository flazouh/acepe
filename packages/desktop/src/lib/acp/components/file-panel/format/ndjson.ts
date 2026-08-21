import { fromThrowable } from "@acepe/effect-result/fromThrowable";
import * as Effect from "effect/Effect";
import type * as Result from "effect/Result";
import { parseJsonLines } from "./parsers/ndjson.js";
import type { FormatConfig, StructuredData } from "./types.js";

export const ndjsonConfig: FormatConfig = {
	kind: "ndjson",
	extensions: ["ndjson", "jsonl"],
	displayOptions: {
		availableModes: ["structured", "raw"],
		defaultMode: "structured",
	},
	parseStructured: (content: string): Result.Result<StructuredData, Error> => {
		const parseNdjson = fromThrowable(
			() => parseJsonLines(content),
			(error) =>
				error instanceof Error
					? new Error(`Invalid NDJSON: ${error.message}`)
					: new Error("Invalid NDJSON")
		);
		return Effect.runSync(Effect.result(parseNdjson()));
	},
};
