import { Result } from "neverthrow";
import { parseIniLike } from "./parsers/sectioned.js";
import type { FormatConfig, StructuredData } from "./types.js";

export const iniConfig: FormatConfig = {
	kind: "ini",
	extensions: ["ini", "conf", "cfg"],
	displayOptions: {
		availableModes: ["structured", "raw"],
		defaultMode: "structured",
	},
	parseStructured: (content: string): Result<StructuredData, Error> =>
		Result.fromThrowable(
			() => parseIniLike(content),
			(error) =>
				error instanceof Error
					? new Error(`Invalid INI/CONF: ${error.message}`)
					: new Error("Invalid INI/CONF")
		)(),
};
