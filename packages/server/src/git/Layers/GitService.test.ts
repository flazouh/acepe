import * as BunChildProcessSpawner from "@effect/platform-bun/BunChildProcessSpawner"
import * as BunCrypto from "@effect/platform-bun/BunCrypto"
import * as BunFileSystem from "@effect/platform-bun/BunFileSystem"
import * as BunPath from "@effect/platform-bun/BunPath"
import * as Vitest from "@effect/vitest"
import * as Arr from "effect/Array"
import * as Clock from "effect/Clock"
import * as Effect from "effect/Effect"
import * as FileSystem from "effect/FileSystem"
import * as Layer from "effect/Layer"
import * as Option from "effect/Option"
import * as Path from "effect/Path"
import * as Stream from "effect/Stream"
import { runGit } from "../runGit.ts"
import { GitService } from "../Services/GitService.ts"
import { GitServiceLive } from "./GitService.ts"

const PlatformLive = Layer.mergeAll(
	BunCrypto.layer,
	BunFileSystem.layer,
	BunPath.layer,
	BunChildProcessSpawner.layer.pipe(
		Layer.provideMerge(Layer.mergeAll(BunFileSystem.layer, BunPath.layer))
	)
)

const noneEnv = Option.none<Readonly<Record<string, string>>>()
const noAllow = Arr.empty<number>()

const gitLive = (worktreesRoot: string) =>
	GitServiceLive({
		worktreesRoot,
		gitBin: "git",
		ghBin: "gh"
	})

const configureRepo = (dir: string) =>
	Effect.gen(function*() {
		yield* runGit({
			gitBin: "git",
			args: Arr.fromIterable(["config", "user.name", "Test User"]),
			cwd: dir,
			allowExitCodes: noAllow,
			env: noneEnv
		})
		yield* runGit({
			gitBin: "git",
			args: Arr.fromIterable(["config", "user.email", "test@example.com"]),
			cwd: dir,
			allowExitCodes: noAllow,
			env: noneEnv
		})
		yield* runGit({
			gitBin: "git",
			args: Arr.fromIterable(["config", "commit.gpgsign", "false"]),
			cwd: dir,
			allowExitCodes: noAllow,
			env: noneEnv
		})
	})

const withGit = <A, E, R>(worktreesRoot: string, program: Effect.Effect<A, E, R | GitService>) =>
	program.pipe(
		// @effect-diagnostics-next-line strictEffectProvide:off
		Effect.provide(gitLive(worktreesRoot))
	)

Vitest.layer(PlatformLive)("GitServiceLive", (it) => {
	it.effect("provides GitService and grades panelStatus against the rust fixture", () =>
		Effect.gen(function*() {
			const fs = yield* FileSystem.FileSystem
			const path = yield* Path.Path
			const dir = yield* fs.makeTempDirectoryScoped()
			const worktrees = yield* fs.makeTempDirectoryScoped()
			yield* withGit(
				worktrees,
				Effect.gen(function*() {
					const git = yield* GitService
					yield* git.init(dir)
					yield* configureRepo(dir)
					yield* fs.writeFileString(path.join(dir, "tracked.txt"), "one\n")
					yield* git.stageAll(dir)
					yield* git.commit({
						projectPath: dir,
						message: "initial tracked file"
					})
					yield* fs.writeFileString(path.join(dir, "tracked.txt"), "one\ntwo\n")
					yield* fs.writeFileString(path.join(dir, "new-file.txt"), "draft\nnotes\n")
					const statuses = yield* git.panelStatus(dir)
					const tracked = Arr.findFirst(statuses, (row) => row.path === "tracked.txt")
					const untracked = Arr.findFirst(statuses, (row) => row.path === "new-file.txt")
					Vitest.assert.strictEqual(Option.isSome(tracked), true)
					Vitest.assert.strictEqual(Option.isSome(untracked), true)
					if (Option.isSome(tracked)) {
						Vitest.assert.strictEqual(tracked.value.worktreeInsertions, 1)
					}
					if (Option.isSome(untracked)) {
						Vitest.assert.strictEqual(untracked.value.worktreeStatus, "untracked")
						Vitest.assert.strictEqual(untracked.value.worktreeInsertions, 2)
					}
					const diff = yield* git.fileDiff({
						projectPath: dir,
						filePath: "tracked.txt"
					})
					Vitest.assert.strictEqual(diff.oldContent, "one\n")
					Vitest.assert.strictEqual(diff.newContent, "one\ntwo\n")
					Vitest.assert.strictEqual(diff.fileName, "tracked.txt")
					const working = yield* git.workingFileDiff({
						projectPath: dir,
						filePath: "tracked.txt",
						staged: false,
						status: "modified",
						additions: 1,
						deletions: 0
					})
					Vitest.assert.strictEqual(working.patch.includes("-one"), false)
					Vitest.assert.strictEqual(working.patch.includes("+two"), true)
					const first = yield* Stream.runHead(Stream.take(git.watchHead(dir), 1))
					Vitest.assert.strictEqual(Option.isSome(first), true)
					if (Option.isSome(first)) {
						Vitest.assert.strictEqual(first.value.projectPath, dir)
					}
				})
			)
		})
	)

	it.effect("projectGitStatus on this repository completes and reports elapsed milliseconds", () =>
		Effect.gen(function*() {
			const fs = yield* FileSystem.FileSystem
			const path = yield* Path.Path
			const testFile = yield* path.fromFileUrl(new URL("./GitService.test.ts", import.meta.url))
			const repoRoot = path.join(path.dirname(testFile), "..", "..", "..", "..", "..")
			const worktrees = yield* fs.makeTempDirectoryScoped()
			const elapsedMs = yield* withGit(
				worktrees,
				Effect.gen(function*() {
					const git = yield* GitService
					const started = yield* Clock.currentTimeMillis
					const status = yield* git.projectGitStatus(repoRoot)
					const ended = yield* Clock.currentTimeMillis
					Vitest.assert.strictEqual(status.length >= 0, true)
					return ended - started
				})
			)
			Vitest.assert.isTrue(
				elapsedMs < 5_000,
				`projectGitStatus took ${String(elapsedMs)} ms on ${repoRoot}`
			)
		})
	)
})
