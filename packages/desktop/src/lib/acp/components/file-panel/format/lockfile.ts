import { fromThrowable } from "@acepe/effect-result/fromThrowable";
import * as Effect from "effect/Effect";
import type * as Result from "effect/Result";
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
	parseStructured: (content: string): Result.Result<StructuredData, Error> => {
		const parseLockfileContent = fromThrowable(
			() => parseLockfile(content),
			(error) =>
				error instanceof Error
					? new Error(`Invalid lockfile: ${error.message}`)
					: new Error("Invalid lockfile")
		);
		return Effect.runSync(Effect.result(parseLockfileContent()));
	},
};
