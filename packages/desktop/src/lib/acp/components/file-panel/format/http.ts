import { Result } from "neverthrow";
import { parseHttpLike } from "./parsers/http.js";
import type { FormatConfig, StructuredData } from "./types.js";

export const httpConfig: FormatConfig = {
	kind: "http",
	extensions: ["http", "rest"],
	displayOptions: {
		availableModes: ["structured", "raw"],
		defaultMode: "structured",
	},
	parseStructured: (content: string): Result<StructuredData, Error> =>
		Result.fromThrowable(
			() => parseHttpLike(content),
			(error) =>
				error instanceof Error
					? new Error(`Invalid HTTP file: ${error.message}`)
					: new Error("Invalid HTTP file")
		)(),
};
