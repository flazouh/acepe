import * as Vitest from "@effect/vitest"
import * as BunFileSystem from "@effect/platform-bun/BunFileSystem"
import * as BunPath from "@effect/platform-bun/BunPath"
import * as Arr from "effect/Array"
import * as Effect from "effect/Effect"
import * as FileSystem from "effect/FileSystem"
import * as Layer from "effect/Layer"
import * as Option from "effect/Option"
import * as Path from "effect/Path"
import { isHiddenName, listChildDirectories, modifiedAtMillis } from "./fsWalk.ts"

const PlatformLive = Layer.mergeAll(BunFileSystem.layer, BunPath.layer)

Vitest.describe("isHiddenName", () => {
	Vitest.it("skips dotfiles and traversal names", () => {
		Vitest.assert.strictEqual(isHiddenName(".hidden"), true)
		Vitest.assert.strictEqual(isHiddenName("."), true)
		Vitest.assert.strictEqual(isHiddenName(".."), true)
		Vitest.assert.strictEqual(isHiddenName("review"), false)
	})
})

Vitest.describe("modifiedAtMillis", () => {
	Vitest.it("returns 0 when mtime is missing", () => {
		Vitest.assert.strictEqual(modifiedAtMillis(Option.none()), 0)
	})
})

Vitest.layer(PlatformLive)("listChildDirectories", (it) => {
	it.effect("returns sorted visible directories", () =>
		Effect.gen(function*() {
			const fs = yield* FileSystem.FileSystem
			const path = yield* Path.Path
			const root = yield* fs.makeTempDirectoryScoped()
			yield* fs.makeDirectory(path.join(root, "beta"), { recursive: true })
			yield* fs.makeDirectory(path.join(root, "alpha"), { recursive: true })
			yield* fs.makeDirectory(path.join(root, ".skip"), { recursive: true })
			yield* fs.writeFileString(path.join(root, "file.txt"), "nope\n")
			const entries = yield* listChildDirectories(fs, path, root)
			Vitest.assert.deepStrictEqual(
				Arr.map(entries, (entry) => entry.name),
				["alpha", "beta"]
			)
		})
	)
})
