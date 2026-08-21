import { fromThrowable } from "@acepe/effect-result/fromThrowable";
import * as Effect from "effect/Effect";
import type * as Result from "effect/Result";
import { parseTomlLike } from "./parsers/sectioned.js";
import type { FormatConfig, StructuredData } from "./types.js";

export const tomlConfig: FormatConfig = {
	kind: "toml",
	extensions: ["toml"],
	displayOptions: {
		availableModes: ["structured", "raw"],
		defaultMode: "structured",
	},
	parseStructured: (content: string): Result.Result<StructuredData, Error> => {
		const parseToml = fromThrowable(
			() => parseTomlLike(content),
			(error) =>
				error instanceof Error
					? new Error(`Invalid TOML: ${error.message}`)
					: new Error("Invalid TOML")
		);
		return Effect.runSync(Effect.result(parseToml()));
	},
};
