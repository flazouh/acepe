import { SessionId } from "@acepe/contracts"
import * as BunFileSystem from "@effect/platform-bun/BunFileSystem"
import * as BunPath from "@effect/platform-bun/BunPath"
import * as Vitest from "@effect/vitest"
import * as Effect from "effect/Effect"
import * as FileSystem from "effect/FileSystem"
import * as Layer from "effect/Layer"
import * as Path from "effect/Path"
import * as Result from "effect/Result"
import { applyLinePagination, getDefaultShell, readTextFile, writeTextFile } from "./readWriteText.ts"

const Platform = Layer.mergeAll(BunFileSystem.layer, BunPath.layer)

const sessionId = SessionId.make("session-1")

Vitest.describe("applyLinePagination", () => {
	Vitest.it("returns the content unchanged when line and limit are both absent", () => {
		Vitest.assert.strictEqual(applyLinePagination("a\nb\nc", undefined, undefined), "a\nb\nc")
	})

	Vitest.it("slices from a 1-based start line", () => {
		Vitest.assert.strictEqual(applyLinePagination("a\nb\nc", 2, undefined), "b\nc")
	})

	Vitest.it("caps the slice at limit lines", () => {
		Vitest.assert.strictEqual(applyLinePagination("a\nb\nc\nd", 2, 2), "b\nc")
	})

	Vitest.it("applies limit alone starting from the first line", () => {
		Vitest.assert.strictEqual(applyLinePagination("a\nb\nc", undefined, 1), "a")
	})
})

Vitest.layer(Platform)("readTextFile / writeTextFile", (it) => {
	it.effect("reads back a file it wrote, with parent directories created", () =>
		Effect.gen(function*() {
			const fs = yield* FileSystem.FileSystem
			const path = yield* Path.Path
			const dir = yield* fs.makeTempDirectoryScoped()
			const target = path.join(dir, "nested", "file.txt")

			yield* writeTextFile(fs, path, {
				path: target,
				content: "hello world",
				sessionId
			})
			const content = yield* readTextFile(fs, path, { path: target })

			Vitest.assert.strictEqual(content, "hello world")
		})
	)

	it.effect("paginates a read by line and limit", () =>
		Effect.gen(function*() {
			const fs = yield* FileSystem.FileSystem
			const path = yield* Path.Path
			const dir = yield* fs.makeTempDirectoryScoped()
			const target = path.join(dir, "file.txt")

			yield* writeTextFile(fs, path, { path: target, content: "a\nb\nc\nd", sessionId })
			const content = yield* readTextFile(fs, path, { path: target, line: 2, limit: 2 })

			Vitest.assert.strictEqual(content, "b\nc")
		})
	)

	it.effect("fails to read a relative path", () =>
		Effect.gen(function*() {
			const fs = yield* FileSystem.FileSystem
			const path = yield* Path.Path
			const outcome = yield* Effect.result(
				readTextFile(fs, path, { path: "relative/file.txt" })
			)
			Vitest.assert.isTrue(Result.isFailure(outcome))
		})
	)

	it.effect("fails to write a relative path", () =>
		Effect.gen(function*() {
			const fs = yield* FileSystem.FileSystem
			const path = yield* Path.Path
			const outcome = yield* Effect.result(
				writeTextFile(fs, path, { path: "relative/file.txt", content: "x", sessionId })
			)
			Vitest.assert.isTrue(Result.isFailure(outcome))
		})
	)
})

Vitest.describe("getDefaultShell", () => {
	Vitest.it.effect("resolves a default shell", () =>
		Effect.gen(function*() {
			const shell = yield* getDefaultShell()
			Vitest.assert.isTrue(shell.length > 0)
		})
	)
})
