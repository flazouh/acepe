import { TrimmedNonEmptyString } from "@acepe/contracts"
import * as Arr from "effect/Array"
import * as Effect from "effect/Effect"
import type * as FileSystem from "effect/FileSystem"
import type * as Path from "effect/Path"
import * as Schema from "effect/Schema"
import * as Str from "effect/String"
import { HistoryDirectoryNotFoundError } from "./Errors.ts"

export const MAX_HISTORY_FILES = 50

const decodePath = Schema.decodeUnknownEffect(TrimmedNonEmptyString)

const isJsonlName = (name: string): boolean => Str.endsWith(".jsonl")(name)

export const listJsonlFiles = Effect.fn("listJsonlFiles")(function*(
	fs: FileSystem.FileSystem,
	path: Path.Path,
	root: string
) {
	const exists = yield* fs.exists(root)
	if (exists === false) {
		return yield* new HistoryDirectoryNotFoundError({ path: root })
	}
	const info = yield* fs.stat(root)
	if (info.type === "File") {
		if (path.extname(root) !== ".jsonl") {
			return yield* new HistoryDirectoryNotFoundError({ path: root })
		}
		const filePath = yield* decodePath(root)
		return Arr.of(filePath)
	}
	if (info.type !== "Directory") {
		return yield* new HistoryDirectoryNotFoundError({ path: root })
	}
	const names = yield* fs.readDirectory(root, { recursive: true })
	const jsonlNames = Arr.sort(Arr.filter(names, isJsonlName), Str.Order)
	const limited = Arr.take(jsonlNames, MAX_HISTORY_FILES)
	return yield* Effect.forEach(limited, (name) => decodePath(path.join(root, name)))
})
