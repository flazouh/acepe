import { Result } from "neverthrow";
import { parseLockfile } from "./parsers/ndjson.js";
import type { FormatConfig, StructuredData } from "./types.js";

const LOCKFILE_NAMES = new Set([
	"package-lock.json",
	"pnpm-lock.yaml",
	"pnpm-lock.yml",
	"yarn.lock",
]);

export const lockfileConfig: FormatConfig = {
	kind: "lockfile",
	fileNames: Array.from(LOCKFILE_NAMES),
	displayOptions: {
		availableModes: ["structured", "raw"],
		defaultMode: "structured",
	},
	parseStructured: (content: string): Result<StructuredData, Error> =>
		Result.fromThrowable(
			() => parseLockfile(content),
			(error) =>
				error instanceof Error
					? new Error(`Invalid lockfile: ${error.message}`)
					: new Error("Invalid lockfile")
		)(),
};
