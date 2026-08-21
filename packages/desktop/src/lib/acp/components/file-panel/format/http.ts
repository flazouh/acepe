import { fromThrowable } from "@acepe/effect-result/fromThrowable";
import * as Effect from "effect/Effect";
import type * as Result from "effect/Result";
import { parseHttpLike } from "./parsers/http.js";
import type { FormatConfig, StructuredData } from "./types.js";

export const httpConfig: FormatConfig = {
	kind: "http",
	extensions: ["http", "rest"],
	displayOptions: {
		availableModes: ["structured", "raw"],
		defaultMode: "structured",
	},
	parseStructured: (content: string): Result.Result<StructuredData, Error> => {
		const parseHttp = fromThrowable(
			() => parseHttpLike(content),
			(error) =>
				error instanceof Error
					? new Error(`Invalid HTTP file: ${error.message}`)
					: new Error("Invalid HTTP file")
		);
		return Effect.runSync(Effect.result(parseHttp()));
	},
};
