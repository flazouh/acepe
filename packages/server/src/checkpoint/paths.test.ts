import * as BunFileSystem from "@effect/platform-bun/BunFileSystem"
import * as BunPath from "@effect/platform-bun/BunPath"
import * as Vitest from "@effect/vitest"
import * as Effect from "effect/Effect"
import * as FileSystem from "effect/FileSystem"
import * as Layer from "effect/Layer"
import * as Path from "effect/Path"
import { convertToRelativePath, validateRelativePath } from "./paths.ts"

const Platform = Layer.mergeAll(BunFileSystem.layer, BunPath.layer)

Vitest.layer(Platform)("convertToRelativePath", (it) => {
	it.effect("converts a project file to a forward-slash relative path", () =>
		Effect.gen(function*() {
			const fs = yield* FileSystem.FileSystem
			const path = yield* Path.Path
			const dir = yield* fs.makeTempDirectoryScoped()
			const file = path.join(dir, "src", "file.ts")
			yield* fs.makeDirectory(path.dirname(file), { recursive: true })
			yield* fs.writeFileString(file, "")
			const relative = yield* convertToRelativePath(fs, path, file, dir, null)
			Vitest.assert.strictEqual(relative, "src/file.ts")
		})
	)

	it.effect("prefers the worktree over the project root", () =>
		Effect.gen(function*() {
			const fs = yield* FileSystem.FileSystem
			const path = yield* Path.Path
			const project = yield* fs.makeTempDirectoryScoped()
			const worktree = yield* fs.makeTempDirectoryScoped()
			const file = path.join(worktree, "src", "file.ts")
			yield* fs.makeDirectory(path.dirname(file), { recursive: true })
			yield* fs.writeFileString(file, "")
			const relative = yield* convertToRelativePath(fs, path, file, project, worktree)
			Vitest.assert.strictEqual(relative, "src/file.ts")
		})
	)

	it.effect("rejects a path outside project and worktree", () =>
		Effect.gen(function*() {
			const fs = yield* FileSystem.FileSystem
			const path = yield* Path.Path
			const project = yield* fs.makeTempDirectoryScoped()
			const outside = yield* fs.makeTempDirectoryScoped()
			const file = path.join(outside, "file.ts")
			yield* fs.writeFileString(file, "")
			const error = yield* Effect.flip(convertToRelativePath(fs, path, file, project, null))
			Vitest.assert.strictEqual(error._tag, "CheckpointPathError")
		})
	)

	it.effect("rejects an empty path", () =>
		Effect.gen(function*() {
			const fs = yield* FileSystem.FileSystem
			const path = yield* Path.Path
			const dir = yield* fs.makeTempDirectoryScoped()
			const error = yield* Effect.flip(convertToRelativePath(fs, path, "", dir, null))
			Vitest.assert.strictEqual(error._tag, "CheckpointPathError")
			if (error._tag === "CheckpointPathError") {
				Vitest.assert.strictEqual(error.reason, "Empty path provided")
			}
		})
	)
})

Vitest.layer(Platform)("validateRelativePath", (it) => {
	it.effect("rejects traversal segments", () =>
		Effect.gen(function*() {
			const fs = yield* FileSystem.FileSystem
			const path = yield* Path.Path
			const dir = yield* fs.makeTempDirectoryScoped()
			const error = yield* Effect.flip(validateRelativePath(fs, path, dir, "../etc/passwd"))
			Vitest.assert.strictEqual(error._tag, "CheckpointPathError")
			if (error._tag === "CheckpointPathError") {
				Vitest.assert.isTrue(error.reason.includes("traversal"))
			}
		})
	)

	it.effect("rejects an absolute path", () =>
		Effect.gen(function*() {
			const fs = yield* FileSystem.FileSystem
			const path = yield* Path.Path
			const dir = yield* fs.makeTempDirectoryScoped()
			const error = yield* Effect.flip(validateRelativePath(fs, path, dir, "/etc/passwd"))
			Vitest.assert.strictEqual(error._tag, "CheckpointPathError")
			if (error._tag === "CheckpointPathError") {
				Vitest.assert.isTrue(error.reason.includes("absolute"))
			}
		})
	)

	it.effect("accepts a file that exists under the project", () =>
		Effect.gen(function*() {
			const fs = yield* FileSystem.FileSystem
			const path = yield* Path.Path
			const dir = yield* fs.makeTempDirectoryScoped()
			const file = path.join(dir, "src", "test.ts")
			yield* fs.makeDirectory(path.dirname(file), { recursive: true })
			yield* fs.writeFileString(file, "test")
			const resolved = yield* validateRelativePath(fs, path, dir, "src/test.ts")
			const expected = yield* fs.realPath(file)
			Vitest.assert.strictEqual(resolved, expected)
		})
	)

	it.effect("accepts a new file in an existing directory", () =>
		Effect.gen(function*() {
			const fs = yield* FileSystem.FileSystem
			const path = yield* Path.Path
			const dir = yield* fs.makeTempDirectoryScoped()
			yield* fs.makeDirectory(path.join(dir, "src"), { recursive: true })
			const resolved = yield* validateRelativePath(fs, path, dir, "src/new-file.ts")
			Vitest.assert.isTrue(resolved.endsWith("new-file.ts"))
		})
	)
})
