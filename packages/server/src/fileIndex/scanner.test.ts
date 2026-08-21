import * as BunChildProcessSpawner from "@effect/platform-bun/BunChildProcessSpawner"
import * as BunFileSystem from "@effect/platform-bun/BunFileSystem"
import * as BunPath from "@effect/platform-bun/BunPath"
import * as Vitest from "@effect/vitest"
import * as Arr from "effect/Array"
import * as Effect from "effect/Effect"
import * as FileSystem from "effect/FileSystem"
import * as Layer from "effect/Layer"
import * as Option from "effect/Option"
import * as Path from "effect/Path"
import * as Schema from "effect/Schema"
import * as Str from "effect/String"
import * as ChildProcessSpawner from "effect/unstable/process/ChildProcessSpawner"
import { FileIndexNotADirectoryError, FileIndexRootNotFoundError } from "./Errors.ts"
import { scanProject } from "./scanner.ts"

const Platform = Layer.mergeAll(
	BunFileSystem.layer,
	BunPath.layer,
	BunChildProcessSpawner.layer.pipe(
		Layer.provideMerge(Layer.mergeAll(BunFileSystem.layer, BunPath.layer))
	)
)

const writeTree = Effect.fn("writeTree")(function*(
	fs: FileSystem.FileSystem,
	path: Path.Path,
	root: string
) {
	yield* fs.makeDirectory(path.join(root, "subdir"), { recursive: true })
	yield* fs.makeDirectory(path.join(root, ".git", "hooks"), { recursive: true })
	yield* fs.writeFileString(path.join(root, "file1.ts"), "const x = 1;\n")
	yield* fs.writeFileString(path.join(root, "file2.rs"), "fn main() {}\n")
	yield* fs.writeFileString(path.join(root, "subdir", "nested.js"), "// comment\n")
	yield* fs.writeFileString(path.join(root, ".gitignore"), "ignored.txt\n")
	yield* fs.writeFileString(path.join(root, "ignored.txt"), "// ignored\n")
	yield* fs.writeFileString(path.join(root, ".git", "config"), "[core]\n")
	yield* fs.writeFileString(path.join(root, ".git", "hooks", "pre-commit"), "#!/bin/sh\n"	)
})

Vitest.layer(Platform)("scanProject", (it) => {
	it.effect("indexes files, respects gitignore, and skips .git internals", () =>
		Effect.gen(function*() {
			const fs = yield* FileSystem.FileSystem
			const path = yield* Path.Path
			const spawner = yield* ChildProcessSpawner.ChildProcessSpawner
			const dir = yield* fs.makeTempDirectoryScoped()
			yield* writeTree(fs, path, dir)
			const scanned = yield* scanProject(fs, path, spawner, dir)
			const paths = Arr.sort(
				Arr.map(scanned.files, (file) => file.path),
				Str.Order
			)
			Vitest.assert.deepStrictEqual(paths, [".gitignore", "file1.ts", "file2.rs", "subdir/nested.js"])
			const ts = Arr.findFirst(scanned.files, (file) => file.extension === "ts")
			Vitest.assert.isTrue(Option.isSome(ts))
			if (Option.isSome(ts)) {
				Vitest.assert.strictEqual(ts.value.path.endsWith("file1.ts"), true)
			}
		})
	)

	it.effect("fails when the root is missing", () =>
		Effect.gen(function*() {
			const fs = yield* FileSystem.FileSystem
			const path = yield* Path.Path
			const spawner = yield* ChildProcessSpawner.ChildProcessSpawner
			const error = yield* Effect.flip(
				scanProject(fs, path, spawner, "/missing/acepe-file-index-root")
			)
			Vitest.assert.strictEqual(error._tag, "FileIndexRootNotFoundError")
			Vitest.assert.isTrue(Schema.is(FileIndexRootNotFoundError)(error))
		})
	)

	it.effect("fails when the root is a file", () =>
		Effect.gen(function*() {
			const fs = yield* FileSystem.FileSystem
			const path = yield* Path.Path
			const spawner = yield* ChildProcessSpawner.ChildProcessSpawner
			const dir = yield* fs.makeTempDirectoryScoped()
			const filePath = path.join(dir, "README.md")
			yield* fs.writeFileString(filePath, "hi\n")
			const error = yield* Effect.flip(scanProject(fs, path, spawner, filePath))
			Vitest.assert.strictEqual(error._tag, "FileIndexNotADirectoryError")
			Vitest.assert.isTrue(Schema.is(FileIndexNotADirectoryError)(error))
		})
	)

	it.effect("scans when .git is a worktree gitdir file", () =>
		Effect.gen(function*() {
			const fs = yield* FileSystem.FileSystem
			const path = yield* Path.Path
			const spawner = yield* ChildProcessSpawner.ChildProcessSpawner
			const dir = yield* fs.makeTempDirectoryScoped()
			yield* fs.writeFileString(path.join(dir, ".git"), "gitdir: /missing/acepe-gitdir\n")
			yield* fs.writeFileString(path.join(dir, ".gitignore"), "ignored.txt\n")
			yield* fs.writeFileString(path.join(dir, "kept.ts"), "export const kept = 1\n")
			yield* fs.writeFileString(path.join(dir, "ignored.txt"), "nope\n")
			const scanned = yield* scanProject(fs, path, spawner, dir)
			const paths = Arr.sort(
				Arr.map(scanned.files, (file) => file.path),
				Str.Order
			)
			Vitest.assert.deepStrictEqual(paths, [".gitignore", "kept.ts"])
		})
	)
})
