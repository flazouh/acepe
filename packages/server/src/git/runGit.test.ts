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
import { GitCommandError } from "./Errors.ts"
import { runGit } from "./runGit.ts"

const PlatformLive = Layer.mergeAll(
	BunFileSystem.layer,
	BunPath.layer,
	BunChildProcessSpawner.layer.pipe(
		Layer.provideMerge(Layer.mergeAll(BunFileSystem.layer, BunPath.layer))
	)
)

Vitest.layer(PlatformLive)("runGit", (it) => {
	it.effect("returns stdout from git --version", () =>
		Effect.gen(function*() {
			const fs = yield* FileSystem.FileSystem
			const dir = yield* fs.makeTempDirectoryScoped()
			const stdout = yield* runGit({
				gitBin: "git",
				args: Arr.of("--version"),
				cwd: dir,
				allowExitCodes: Arr.empty(),
				env: Option.none()
			})
			Vitest.assert.strictEqual(stdout.startsWith("git version"), true)
		})
	)

	it.effect("fails with GitCommandError on a unknown git subcommand", () =>
		Effect.gen(function*() {
			const fs = yield* FileSystem.FileSystem
			const dir = yield* fs.makeTempDirectoryScoped()
			const error = yield* Effect.flip(
				runGit({
					gitBin: "git",
					args: Arr.of("this-is-not-a-git-command"),
					cwd: dir,
					allowExitCodes: Arr.empty(),
					env: Option.none()
				})
			)
			Vitest.assert.strictEqual(error._tag, "GitCommandError")
			Vitest.assert.strictEqual(Schema.is(GitCommandError)(error), true)
		})
	)

	it.effect("allows git diff exit code 1", () =>
		Effect.gen(function*() {
			const fs = yield* FileSystem.FileSystem
			const path = yield* Path.Path
			const dir = yield* fs.makeTempDirectoryScoped()
			yield* fs.writeFileString(path.join(dir, "a.txt"), "one\n")
			yield* fs.writeFileString(path.join(dir, "b.txt"), "two\n")
			const stdout = yield* runGit({
				gitBin: "git",
				args: Arr.fromIterable(["diff", "--no-index", "--", "a.txt", "b.txt"]),
				cwd: dir,
				allowExitCodes: Arr.of(1),
				env: Option.none()
			})
			Vitest.assert.strictEqual(stdout.includes("-one"), true)
			Vitest.assert.strictEqual(stdout.includes("+two"), true)
		})
	)
})
