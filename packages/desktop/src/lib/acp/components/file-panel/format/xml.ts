import { fromThrowable } from "@acepe/effect-result/fromThrowable";
import * as Effect from "effect/Effect";
import type * as Result from "effect/Result";
import { parseXmlToStructured } from "./parsers/xml.js";
import type { FormatConfig, StructuredData } from "./types.js";

export const xmlConfig: FormatConfig = {
	kind: "xml",
	extensions: ["xml"],
	displayOptions: {
		availableModes: ["structured", "raw"],
		defaultMode: "structured",
	},
	parseStructured: (content: string): Result.Result<StructuredData, Error> => {
		const parseXml = fromThrowable(
			() => parseXmlToStructured(content),
			(error) =>
				error instanceof Error
					? new Error(`Invalid XML: ${error.message}`)
					: new Error("Invalid XML")
		);
		return Effect.runSync(Effect.result(parseXml()));
	},
};
