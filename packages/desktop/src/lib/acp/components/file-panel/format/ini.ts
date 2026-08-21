import { fromThrowable } from "@acepe/effect-result/fromThrowable";
import * as Effect from "effect/Effect";
import type * as Result from "effect/Result";
import { parseIniLike } from "./parsers/sectioned.js";
import type { FormatConfig, StructuredData } from "./types.js";

export const iniConfig: FormatConfig = {
	kind: "ini",
	extensions: ["ini", "conf", "cfg"],
	displayOptions: {
		availableModes: ["structured", "raw"],
		defaultMode: "structured",
	},
	parseStructured: (content: string): Result.Result<StructuredData, Error> => {
		const parseIni = fromThrowable(
			() => parseIniLike(content),
			(error) =>
				error instanceof Error
					? new Error(`Invalid INI/CONF: ${error.message}`)
					: new Error("Invalid INI/CONF")
		);
		return Effect.runSync(Effect.result(parseIni()));
	},
};
