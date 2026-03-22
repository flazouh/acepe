import { Result } from "neverthrow";
import { parseEnvLike } from "./parsers/env.js";
import type { FormatConfig, StructuredData } from "./types.js";

export const envConfig: FormatConfig = {
	kind: "env",
	matchFile: (fileName) => fileName === ".env" || fileName.startsWith(".env."),
	displayOptions: {
		availableModes: ["structured", "raw"],
		defaultMode: "structured",
	},
	parseStructured: (content: string): Result<StructuredData, Error> =>
		Result.fromThrowable(
			() => parseEnvLike(content),
			(error) =>
				error instanceof Error
					? new Error(`Invalid ENV: ${error.message}`)
					: new Error("Invalid ENV")
		)(),
};
