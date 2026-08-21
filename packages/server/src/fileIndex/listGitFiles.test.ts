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
import * as ChildProcessSpawner from "effect/unstable/process/ChildProcessSpawner"
import { runGit } from "../git/runGit.ts"
import { joinUnderRoot, listGitFiles, resolveGitExcludePath } from "./listGitFiles.ts"

const Platform = Layer.mergeAll(
	BunFileSystem.layer,
	BunPath.layer,
	BunChildProcessSpawner.layer.pipe(
		Layer.provideMerge(Layer.mergeAll(BunFileSystem.layer, BunPath.layer))
	)
)

const noneEnv = Option.none<Readonly<Record<string, string>>>()

Vitest.layer(Platform)("listGitFiles", (it) => {
	it.effect("joins posix segments under the project root", () =>
		Effect.gen(function*() {
			const pathApi = yield* Path.Path
			Vitest.assert.strictEqual(joinUnderRoot(pathApi, "/tmp/proj", ""), "/tmp/proj")
			Vitest.assert.strictEqual(
				joinUnderRoot(pathApi, "/tmp/proj", "pkg/.gitignore"),
				"/tmp/proj/pkg/.gitignore"
			)
		})
	)
	it.effect("returns none when the directory is not a git work tree", () =>
		Effect.gen(function*() {
			const fs = yield* FileSystem.FileSystem
			const spawner = yield* ChildProcessSpawner.ChildProcessSpawner
			const dir = yield* fs.makeTempDirectoryScoped()
			const listed = yield* listGitFiles(spawner, dir)
			Vitest.assert.deepStrictEqual(listed, Option.none())
		})
	)

	it.effect("lists tracked and untracked files after git init", () =>
		Effect.gen(function*() {
			const fs = yield* FileSystem.FileSystem
			const pathApi = yield* Path.Path
			const spawner = yield* ChildProcessSpawner.ChildProcessSpawner
			const dir = yield* fs.makeTempDirectoryScoped()
			yield* runGit({
				gitBin: "git",
				args: Arr.of("init"),
				cwd: dir,
				allowExitCodes: Arr.empty(),
				env: noneEnv
			})
			yield* fs.writeFileString(pathApi.join(dir, "keep.ts"), "export const keep = 1\n")
			yield* fs.writeFileString(pathApi.join(dir, ".gitignore"), "ignored.txt\n")
			yield* fs.writeFileString(pathApi.join(dir, "ignored.txt"), "nope\n")
			const listed = yield* listGitFiles(spawner, dir)
			Vitest.assert.isTrue(Option.isSome(listed))
			if (Option.isSome(listed)) {
				Vitest.assert.strictEqual(listed.value.includes("keep.ts"), true)
				Vitest.assert.strictEqual(listed.value.includes(".gitignore"), true)
				Vitest.assert.strictEqual(listed.value.includes("ignored.txt"), false)
			}
		})
	)

	it.effect("resolves info/exclude after git init", () =>
		Effect.gen(function*() {
			const fs = yield* FileSystem.FileSystem
			const pathApi = yield* Path.Path
			const spawner = yield* ChildProcessSpawner.ChildProcessSpawner
			const dir = yield* fs.makeTempDirectoryScoped()
			yield* runGit({
				gitBin: "git",
				args: Arr.of("init"),
				cwd: dir,
				allowExitCodes: Arr.empty(),
				env: noneEnv
			})
			const resolved = yield* resolveGitExcludePath(spawner, pathApi, dir)
			Vitest.assert.isTrue(Option.isSome(resolved))
			if (Option.isSome(resolved)) {
				Vitest.assert.strictEqual(resolved.value.includes("info/exclude"), true)
			}
		})
	)
})
