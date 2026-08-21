import * as BunFileSystem from "@effect/platform-bun/BunFileSystem"
import * as BunPath from "@effect/platform-bun/BunPath"
import * as Vitest from "@effect/vitest"
import * as Arr from "effect/Array"
import * as Effect from "effect/Effect"
import * as FileSystem from "effect/FileSystem"
import * as Layer from "effect/Layer"
import * as Path from "effect/Path"
import { listJsonlFiles, MAX_HISTORY_FILES } from "./files.ts"

const Platform = Layer.mergeAll(BunFileSystem.layer, BunPath.layer)

Vitest.layer(Platform)("listJsonlFiles", (it) => {
	it.effect("lists jsonl files recursively in sorted order", () =>
		Effect.gen(function*() {
			const fs = yield* FileSystem.FileSystem
			const path = yield* Path.Path
			const dir = yield* fs.makeTempDirectoryScoped()
			yield* fs.makeDirectory(path.join(dir, "nested"), { recursive: true })
			yield* fs.writeFileString(path.join(dir, "b.jsonl"), "{}\n")
			yield* fs.writeFileString(path.join(dir, "a.jsonl"), "{}\n")
			yield* fs.writeFileString(path.join(dir, "skip.txt"), "nope")
			yield* fs.writeFileString(path.join(dir, "nested", "c.jsonl"), "{}\n")
			const files = yield* listJsonlFiles(fs, path, dir)
			Vitest.assert.deepStrictEqual(
				Arr.map(files, (file) => path.basename(file)),
				["a.jsonl", "b.jsonl", "c.jsonl"]
			)
		})
	)

	it.effect("accepts a single jsonl file path", () =>
		Effect.gen(function*() {
			const fs = yield* FileSystem.FileSystem
			const path = yield* Path.Path
			const dir = yield* fs.makeTempDirectoryScoped()
			const filePath = path.join(dir, "session.jsonl")
			yield* fs.writeFileString(filePath, "{}\n")
			const files = yield* listJsonlFiles(fs, path, filePath)
			Vitest.assert.deepStrictEqual(files, [filePath])
		})
	)

	it.effect("fails with a typed error when the directory is missing", () =>
		Effect.gen(function*() {
			const fs = yield* FileSystem.FileSystem
			const path = yield* Path.Path
			const error = yield* Effect.flip(listJsonlFiles(fs, path, "/missing/acepe-history-root"))
			Vitest.assert.strictEqual(error._tag, "HistoryDirectoryNotFoundError")
			if (error._tag === "HistoryDirectoryNotFoundError") {
				Vitest.assert.strictEqual(error.path, "/missing/acepe-history-root")
			}
		})
	)

	it.effect("caps listed files at MAX_HISTORY_FILES", () =>
		Effect.gen(function*() {
			const fs = yield* FileSystem.FileSystem
			const path = yield* Path.Path
			const dir = yield* fs.makeTempDirectoryScoped()
			let index = 0
			while (index < MAX_HISTORY_FILES + 3) {
				const name = `session-${String(index).padStart(3, "0")}.jsonl`
				yield* fs.writeFileString(path.join(dir, name), "{}\n")
				index = index + 1
			}
			const files = yield* listJsonlFiles(fs, path, dir)
			Vitest.assert.strictEqual(files.length, MAX_HISTORY_FILES)
		})
	)
})
