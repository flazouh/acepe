import * as BunChildProcessSpawner from "@effect/platform-bun/BunChildProcessSpawner"
import * as BunCrypto from "@effect/platform-bun/BunCrypto"
import * as BunFileSystem from "@effect/platform-bun/BunFileSystem"
import * as BunPath from "@effect/platform-bun/BunPath"
import * as Vitest from "@effect/vitest"
import * as Arr from "effect/Array"
import * as Effect from "effect/Effect"
import * as FileSystem from "effect/FileSystem"
import * as Layer from "effect/Layer"
import * as Option from "effect/Option"
import * as Path from "effect/Path"
import { makeGitService } from "./makeGitService.ts"
import { runGit } from "./runGit.ts"
import { GitService } from "./Services/GitService.ts"

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

const gitLayer = (worktreesRoot: string) =>
	Layer.effect(
		GitService,
		makeGitService({
			worktreesRoot,
			gitBin: "git",
			ghBin: "gh"
		})
	)

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
		Effect.provide(gitLayer(worktreesRoot))
	)

Vitest.layer(PlatformLive)("makeGitService", (it) => {
	it.effect("init, commit, log, and currentBranch grade a local fixture repo", () =>
		Effect.gen(function*() {
			const fs = yield* FileSystem.FileSystem
			const path = yield* Path.Path
			const dir = yield* fs.makeTempDirectoryScoped()
			const worktrees = yield* fs.makeTempDirectoryScoped()
			yield* withGit(
				worktrees,
				Effect.gen(function*() {
					const git = yield* GitService
					Vitest.assert.strictEqual(yield* git.isRepo(dir), false)
					yield* git.init(dir)
					yield* configureRepo(dir)
					Vitest.assert.strictEqual(yield* git.isRepo(dir), true)
					yield* fs.writeFileString(path.join(dir, "readme.txt"), "hello\n")
					yield* git.stageAll(dir)
					const committed = yield* git.commit({
						projectPath: dir,
						message: "Initial commit"
					})
					Vitest.assert.strictEqual(committed.sha.length > 0, true)
					Vitest.assert.strictEqual(committed.shortSha.length > 0, true)
					const branch = yield* git.currentBranch(dir)
					Vitest.assert.strictEqual(branch.length > 0, true)
					const entries = yield* git.log({
						projectPath: dir,
						limit: 10
					})
					Vitest.assert.strictEqual(entries.length, 1)
					Vitest.assert.strictEqual(entries[0]?.message, "Initial commit")
					Vitest.assert.strictEqual(entries[0]?.sha, committed.sha)
				})
			)
		})
	)

	it.effect("panelStatus grades the rust git_panel_status fixture", () =>
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
						Vitest.assert.strictEqual(tracked.value.worktreeDeletions, 0)
					}
					if (Option.isSome(untracked)) {
						Vitest.assert.strictEqual(untracked.value.worktreeStatus, "untracked")
						Vitest.assert.strictEqual(untracked.value.worktreeInsertions, 2)
						Vitest.assert.strictEqual(untracked.value.worktreeDeletions, 0)
					}
				})
			)
		})
	)

	it.effect("fileDiff and workingFileDiff keep pierre-compatible content", () =>
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
					yield* fs.writeFileString(path.join(dir, "src-a.ts"), "old\n")
					yield* git.stageAll(dir)
					yield* git.commit({
						projectPath: dir,
						message: "add file"
					})
					yield* fs.writeFileString(path.join(dir, "src-a.ts"), "new\n")
					const diff = yield* git.fileDiff({
						projectPath: dir,
						filePath: "src-a.ts"
					})
					Vitest.assert.strictEqual(diff.oldContent, "old\n")
					Vitest.assert.strictEqual(diff.newContent, "new\n")
					Vitest.assert.strictEqual(diff.fileName, "src-a.ts")
					const working = yield* git.workingFileDiff({
						projectPath: dir,
						filePath: "src-a.ts",
						staged: false,
						status: "modified",
						additions: 1,
						deletions: 1
					})
					Vitest.assert.strictEqual(working.path, "src-a.ts")
					Vitest.assert.strictEqual(working.patch.includes("@@"), true)
					Vitest.assert.strictEqual(working.patch.includes("-old"), true)
					Vitest.assert.strictEqual(working.patch.includes("+new"), true)
				})
			)
		})
	)

	it.effect("blame, branch, stash, and discard grade against a fixture worktree", () =>
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
					yield* fs.writeFileString(path.join(dir, "note.txt"), "hello\nworld\n")
					yield* git.stageAll(dir)
					yield* git.commit({
						projectPath: dir,
						message: "First line"
					})
					const rows = yield* git.blame({
						projectPath: dir,
						filePath: "note.txt"
					})
					Vitest.assert.strictEqual(rows.length, 2)
					Vitest.assert.strictEqual(rows[0]?.line, 1)
					Vitest.assert.strictEqual(rows[0]?.author, "Test User")
					const created = yield* git.createBranch({
						projectPath: dir,
						name: "topic"
					})
					Vitest.assert.strictEqual(created, "topic")
					const branches = yield* git.listBranches(dir)
					Vitest.assert.strictEqual(Arr.contains(branches, "topic"), true)
					yield* git.checkoutBranch({
						projectPath: dir,
						branch: "topic",
						create: false
					})
					Vitest.assert.strictEqual(yield* git.currentBranch(dir), "topic")
					yield* fs.writeFileString(path.join(dir, "note.txt"), "hello\nworld\nextra\n")
					yield* git.stashSave({
						projectPath: dir,
						message: "wip"
					})
					const stashes = yield* git.stashList(dir)
					Vitest.assert.strictEqual(stashes.length, 1)
					Vitest.assert.strictEqual(stashes[0]?.index, 0)
					yield* git.stashPop({
						projectPath: dir,
						index: 0
					})
					yield* git.discardChanges({
						projectPath: dir,
						files: Arr.of("note.txt")
					})
					const afterDiscard = yield* fs.readFileString(path.join(dir, "note.txt"))
					Vitest.assert.strictEqual(afterDiscard, "hello\nworld\n")
					const empty = yield* Effect.flip(
						git.commit({
							projectPath: dir,
							message: "   "
						})
					)
					Vitest.assert.strictEqual(empty._tag, "GitEmptyCommitMessageError")
					const remote = yield* git.remoteStatus(dir)
					Vitest.assert.strictEqual(remote.ahead, 0)
					Vitest.assert.strictEqual(remote.behind, 0)
					const invalid = yield* Effect.flip(
						git.clone({
							url: "ftp://example.com/repo.git",
							destination: path.join(dir, "out")
						})
					)
					Vitest.assert.strictEqual(invalid._tag, "GitInvalidCloneUrlError")
				})
			)
		})
	)

	it.effect("worktreeCreate lists an acepe worktree and stacked commit records the sha", () =>
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
					yield* fs.writeFileString(path.join(dir, "base.txt"), "base\n")
					yield* git.stageAll(dir)
					yield* git.commit({
						projectPath: dir,
						message: "base"
					})
					const created = yield* git.worktreeCreate(dir)
					Vitest.assert.strictEqual(created.origin, "acepe")
					Vitest.assert.strictEqual(created.name.includes("-"), true)
					const listed = yield* git.worktreeList(dir)
					const found = Arr.findFirst(listed, (row) => row.name === created.name)
					Vitest.assert.strictEqual(Option.isSome(found), true)
					if (Option.isSome(found)) {
						Vitest.assert.strictEqual(found.value.origin, "acepe")
					}
					yield* fs.writeFileString(path.join(dir, "base.txt"), "changed\n")
					yield* git.stageAll(dir)
					const stacked = yield* git.runStackedAction({
						projectPath: dir,
						action: "commit",
						commitMessage: "stacked commit"
					})
					Vitest.assert.strictEqual(stacked.action, "commit")
					Vitest.assert.strictEqual(stacked.commit.status, "created")
					Vitest.assert.strictEqual(stacked.push.status, "skipped_not_requested")
					Vitest.assert.strictEqual(stacked.pr.status, "skipped_not_requested")
					yield* git.worktreeRemove({
						worktreePath: created.directory,
						force: true
					})
				})
			)
		})
	)
})
