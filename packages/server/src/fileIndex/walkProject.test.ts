import * as BunFileSystem from "@effect/platform-bun/BunFileSystem"
import * as BunPath from "@effect/platform-bun/BunPath"
import * as Vitest from "@effect/vitest"
import * as Arr from "effect/Array"
import * as Effect from "effect/Effect"
import * as FileSystem from "effect/FileSystem"
import * as Layer from "effect/Layer"
import * as Path from "effect/Path"
import * as Str from "effect/String"
import { parseGitignore } from "./gitignore.ts"
import { walkProjectFiles } from "./walkProject.ts"

const Platform = Layer.mergeAll(BunFileSystem.layer, BunPath.layer)

Vitest.layer(Platform)("walkProjectFiles", (it) => {
	it.effect("indexes files, respects gitignore, and skips ignored directories", () =>
		Effect.gen(function*() {
			const fs = yield* FileSystem.FileSystem
			const pathApi = yield* Path.Path
			const dir = yield* fs.makeTempDirectoryScoped()
			yield* fs.makeDirectory(pathApi.join(dir, "kept"), { recursive: true })
			yield* fs.makeDirectory(pathApi.join(dir, "bulk"), { recursive: true })
			yield* fs.writeFileString(pathApi.join(dir, ".gitignore"), "bulk/\nignored.txt\n")
			yield* fs.writeFileString(pathApi.join(dir, "kept", "ok.ts"), "export const ok = 1\n")
			yield* fs.writeFileString(pathApi.join(dir, "ignored.txt"), "nope\n")
			yield* fs.writeFileString(pathApi.join(dir, "bulk", "one.ts"), "export const one = 1\n")
			yield* fs.writeFileString(pathApi.join(dir, "bulk", "two.ts"), "export const two = 2\n")
			const walked = yield* walkProjectFiles(fs, pathApi, dir, parseGitignore("", ""))
			const paths = Arr.sort(
				Arr.map(walked.files, (file) => file.path),
				Str.Order
			)
			Vitest.assert.deepStrictEqual(paths, [".gitignore", "kept/ok.ts"])
		})
	)
})
