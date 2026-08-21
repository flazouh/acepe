import { fromThrowable } from "@acepe/effect-result/fromThrowable";
import * as Effect from "effect/Effect";
import type * as Result from "effect/Result";
import { parseEnvLike } from "./parsers/env.js";
import type { FormatConfig, StructuredData } from "./types.js";

export const envConfig: FormatConfig = {
	kind: "env",
	matchFile: (fileName) => fileName === ".env" || fileName.startsWith(".env."),
	displayOptions: {
		availableModes: ["structured", "raw"],
		defaultMode: "structured",
	},
	parseStructured: (content: string): Result.Result<StructuredData, Error> => {
		const parseEnv = fromThrowable(
			() => parseEnvLike(content),
			(error) =>
				error instanceof Error
					? new Error(`Invalid ENV: ${error.message}`)
					: new Error("Invalid ENV")
		);
		return Effect.runSync(Effect.result(parseEnv()));
	},
};
