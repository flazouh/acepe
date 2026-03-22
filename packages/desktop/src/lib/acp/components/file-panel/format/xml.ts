import { Result } from "neverthrow";
import { parseXmlToStructured } from "./parsers/xml.js";
import type { FormatConfig, StructuredData } from "./types.js";

export const xmlConfig: FormatConfig = {
	kind: "xml",
	extensions: ["xml"],
	displayOptions: {
		availableModes: ["structured", "raw"],
		defaultMode: "structured",
	},
	parseStructured: (content: string): Result<StructuredData, Error> =>
		Result.fromThrowable(
			() => parseXmlToStructured(content),
			(error) =>
				error instanceof Error
					? new Error(`Invalid XML: ${error.message}`)
					: new Error("Invalid XML")
		)(),
};
