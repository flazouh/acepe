import * as BunFileSystem from "@effect/platform-bun/BunFileSystem"
import * as BunPath from "@effect/platform-bun/BunPath"
import * as Vitest from "@effect/vitest"
import * as Effect from "effect/Effect"
import * as FileSystem from "effect/FileSystem"
import * as Layer from "effect/Layer"
import * as Path from "effect/Path"
import * as Result from "effect/Result"

import { imageMediaType, MAX_IMAGE_BYTES, readImageDataUrl } from "./readImageDataUrl.ts"

const Platform = Layer.mergeAll(BunFileSystem.layer, BunPath.layer)

const withTempDir = <A, E>(
	body: (dir: string, fs: FileSystem.FileSystem, path: Path.Path) => Effect.Effect<A, E>
) =>
	Effect.gen(function*() {
		const fs = yield* FileSystem.FileSystem
		const path = yield* Path.Path
		const dir = yield* fs.makeTempDirectoryScoped()
		return yield* body(dir, fs, path)
	}).pipe(
		Effect.scoped,
		// @effect-diagnostics-next-line strictEffectProvide:off
		Effect.provide(Platform)
	)

Vitest.describe("imageMediaType", () => {
	Vitest.it("names the type each extension serves", () => {
		Vitest.assert.strictEqual(imageMediaType("a/logo.svg"), "image/svg+xml")
		Vitest.assert.strictEqual(imageMediaType("a/logo.PNG"), "image/png")
		Vitest.assert.strictEqual(imageMediaType("a/logo.jpeg"), "image/jpeg")
		Vitest.assert.strictEqual(imageMediaType("a/logo.jpg"), "image/jpeg")
		Vitest.assert.strictEqual(imageMediaType("a/favicon.ico"), "image/x-icon")
	})

	Vitest.it("answers null for anything it cannot name", () => {
		Vitest.assert.strictEqual(imageMediaType("notes.md"), null)
		Vitest.assert.strictEqual(imageMediaType("noextension"), null)
	})
})

Vitest.describe("readImageDataUrl", () => {
	Vitest.it.effect("returns the file's bytes as a data URI", () =>
		withTempDir((dir, fs, path) =>
			Effect.gen(function*() {
				const target = path.join(dir, "logo.svg")
				yield* fs.writeFileString(target, "<svg/>")
				const url = yield* readImageDataUrl(fs, path, { path: target })
				Vitest.assert.strictEqual(url, `data:image/svg+xml;base64,${btoa("<svg/>")}`)
			})
		))

	Vitest.it.effect("refuses a relative path", () =>
		withTempDir((_dir, fs, path) =>
			Effect.gen(function*() {
				const outcome = yield* Effect.result(
					readImageDataUrl(fs, path, { path: "assets/logo.png" })
				)
				Vitest.assert.isTrue(Result.isFailure(outcome))
			})
		))

	Vitest.it.effect("refuses a file that is not an image, whatever it holds", () =>
		withTempDir((dir, fs, path) =>
			Effect.gen(function*() {
				const target = path.join(dir, "notes.md")
				yield* fs.writeFileString(target, "# hi")
				const outcome = yield* Effect.result(readImageDataUrl(fs, path, { path: target }))
				Vitest.assert.isTrue(Result.isFailure(outcome))
			})
		))

	Vitest.it.effect("refuses a file that is not there", () =>
		withTempDir((dir, fs, path) =>
			Effect.gen(function*() {
				const outcome = yield* Effect.result(
					readImageDataUrl(fs, path, { path: path.join(dir, "missing.png") })
				)
				Vitest.assert.isTrue(Result.isFailure(outcome))
			})
		))

	Vitest.it.effect("refuses an image over the size cap", () =>
		withTempDir((dir, fs, path) =>
			Effect.gen(function*() {
				const target = path.join(dir, "huge.png")
				yield* fs.writeFileString(target, "x".repeat(MAX_IMAGE_BYTES + 1))
				const outcome = yield* Effect.result(readImageDataUrl(fs, path, { path: target }))
				Vitest.assert.isTrue(Result.isFailure(outcome))
			})
		))

	Vitest.it.effect("round-trips binary bytes, not just text", () =>
		withTempDir((dir, fs, path) =>
			Effect.gen(function*() {
				const target = path.join(dir, "pixel.png")
				const bytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x00, 0xff])
				yield* fs.writeFile(target, bytes)
				const url = yield* readImageDataUrl(fs, path, { path: target })
				const base64 = url.slice(url.indexOf(",") + 1)
				Vitest.assert.deepStrictEqual(
					Array.from(Buffer.from(base64, "base64")),
					Array.from(bytes)
				)
			})
		))
})
