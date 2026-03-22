import { Result } from "neverthrow";
import { parseTomlLike } from "./parsers/sectioned.js";
import type { FormatConfig, StructuredData } from "./types.js";

export const tomlConfig: FormatConfig = {
	kind: "toml",
	extensions: ["toml"],
	displayOptions: {
		availableModes: ["structured", "raw"],
		defaultMode: "structured",
	},
	parseStructured: (content: string): Result<StructuredData, Error> =>
		Result.fromThrowable(
			() => parseTomlLike(content),
			(error) =>
				error instanceof Error
					? new Error(`Invalid TOML: ${error.message}`)
					: new Error("Invalid TOML")
		)(),
};
