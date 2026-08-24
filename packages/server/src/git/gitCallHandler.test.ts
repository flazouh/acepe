import { ProjectId } from "@acepe/contracts"
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
import * as Result from "effect/Result"
import { type ProjectedProject, ProjectionProjects } from "../persistence/Services/ProjectionProjects.ts"
import { AppDataDir } from "../rpc/fsPathGuard.ts"
import { routeGitCall } from "./gitCallHandler.ts"
import { makeGitService } from "./makeGitService.ts"
import { runCommand, runGit } from "./runGit.ts"
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

const NOW = "2026-08-20T12:00:00.000Z"

const fakeProject = (workspaceRoot: string): ProjectedProject => ({
	projectId: ProjectId.make("project-1"),
	title: "Acepe",
	workspaceRoot,
	createdAt: NOW,
	updatedAt: NOW,
	deletedAt: null,
	sessionCount: 0,
	scanWarmedAt: NOW
})

const ProjectionProjectsFake = (projects: ReadonlyArray<ProjectedProject>) =>
	Layer.succeed(ProjectionProjects, {
		name: "projection.projects",
		apply: () => Effect.void,
		truncate: () => Effect.void,
		list: () => Effect.succeed(projects),
		get: () => Effect.succeed(Option.none())
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

// One project root (registered with ProjectionProjects, so guardFsPath
// allows it and everything nested under it) and one app data dir (its
// worktrees subdirectory is where makeGitService puts acepe-managed
// worktrees, mirroring bootstrap.ts) are shared across every test below --
// each test gets its own fresh subdirectory of the project root via
// freshRepoDir so tests never see each other's git state.
const TestLive = Layer.unwrap(
	Effect.gen(function*() {
		const fs = yield* FileSystem.FileSystem
		// realPath: on macOS, makeTempDirectoryScoped returns a /var/... path
		// that is itself a symlink to /private/var/...; git worktree list
		// reports the resolved form, so an unresolved projectPath would look
		// like a *different* worktree than itself and get filtered out of
		// listBranches's result.
		const project = yield* fs.makeTempDirectoryScoped().pipe(Effect.flatMap((dir) => fs.realPath(dir)))
		const appData = yield* fs.makeTempDirectoryScoped().pipe(Effect.flatMap((dir) => fs.realPath(dir)))
		return Layer.mergeAll(
			ProjectionProjectsFake([fakeProject(project)]),
			Layer.succeed(AppDataDir, AppDataDir.of({ path: appData })),
			Layer.effect(
				GitService,
				makeGitService({
					worktreesRoot: appData,
					gitBin: "git",
					ghBin: "gh"
				})
			)
		)
	})
).pipe(Layer.provide(PlatformLive))

const freshRepoDir = Effect.fn("freshRepoDir")(function*(label: string) {
	const fs = yield* FileSystem.FileSystem
	const path = yield* Path.Path
	const projects = yield* ProjectionProjects
	const list = yield* projects.list()
	const project = list[0]
	if (project === undefined) {
		return yield* Effect.die("no fake project registered")
	}
	const dir = path.join(project.workspaceRoot, label)
	yield* fs.makeDirectory(dir, { recursive: true })
	return dir
})

// The ship/PR/CI ops that shell out to `gh` (prDetails/prChecks/mergePr) are
// exercised against the real flazouh/acepe GitHub repo -- gh resolves owner/
// repo from a plain `origin` remote, no clone or fetch needed (verified: a
// bare `git init` plus `git remote add origin <url>` is enough). These
// tests skip cleanly (assert nothing, fail nothing) when `gh` isn't
// installed/authenticated, rather than faking a response.
const ghAvailable = Effect.fn("ghAvailable")(function*() {
	const result = yield* Effect.result(
		runCommand({
			bin: "gh",
			args: Arr.fromIterable(["auth", "status"]),
			cwd: ".",
			allowExitCodes: noAllow,
			env: noneEnv
		})
	)
	return Result.isSuccess(result)
})

// gh resolves the target owner/repo from the cwd's git remote, so this only
// needs an initialized repo with the remote configured -- no clone/fetch.
const addAcepeRemote = Effect.fn("addAcepeRemote")(function*(dir: string) {
	yield* runGit({
		gitBin: "git",
		args: Arr.fromIterable(["init"]),
		cwd: dir,
		allowExitCodes: noAllow,
		env: noneEnv
	})
	yield* runGit({
		gitBin: "git",
		args: Arr.fromIterable(["remote", "add", "origin", "https://github.com/flazouh/acepe.git"]),
		cwd: dir,
		allowExitCodes: noAllow,
		env: noneEnv
	})
})

const initRepoWithCommit = Effect.fn("initRepoWithCommit")(function*(dir: string) {
	const fs = yield* FileSystem.FileSystem
	const path = yield* Path.Path
	const git = yield* GitService
	yield* git.init(dir)
	yield* configureRepo(dir)
	yield* fs.writeFileString(path.join(dir, "readme.txt"), "hello\n")
	yield* git.stageAll(dir)
	yield* git.commit({ projectPath: dir, message: "Initial commit" })
})

Vitest.layer(Layer.mergeAll(TestLive, PlatformLive))("gitCallHandler", (it) => {
	it.effect("git.init creates a repo at an allowed subdirectory", () =>
		Effect.gen(function*() {
			const dir = yield* freshRepoDir("init")
			const result = yield* routeGitCall({ op: "git.init", projectPath: dir })
			Vitest.assert.deepStrictEqual(result, { op: "git.init" })
			const isRepo = yield* routeGitCall({ op: "git.isRepo", projectPath: dir })
			Vitest.assert.deepStrictEqual(isRepo, { op: "git.isRepo", isRepo: true })
		})
	)

	it.effect("git.isRepo reports false before init", () =>
		Effect.gen(function*() {
			const dir = yield* freshRepoDir("not-a-repo-yet")
			const result = yield* routeGitCall({ op: "git.isRepo", projectPath: dir })
			Vitest.assert.deepStrictEqual(result, { op: "git.isRepo", isRepo: false })
		})
	)

	it.effect("git.currentBranch, git.listBranches, and git.checkoutBranch drive branch state", () =>
		Effect.gen(function*() {
			const dir = yield* freshRepoDir("branches")
			yield* initRepoWithCommit(dir)
			const current = yield* routeGitCall({ op: "git.currentBranch", projectPath: dir })
			Vitest.assert.strictEqual(current.op, "git.currentBranch")

			const created = yield* routeGitCall({
				op: "git.checkoutBranch",
				projectPath: dir,
				branch: "feature/one",
				create: true
			})
			Vitest.assert.deepStrictEqual(created, { op: "git.checkoutBranch", branch: "feature/one" })

			const branches = yield* routeGitCall({ op: "git.listBranches", projectPath: dir })
			if (branches.op !== "git.listBranches") {
				return yield* Effect.die("expected git.listBranches result")
			}
			Vitest.assert.strictEqual(branches.branches.includes("feature/one"), true)

			const backToCurrent = yield* routeGitCall({ op: "git.currentBranch", projectPath: dir })
			if (backToCurrent.op !== "git.currentBranch") {
				return yield* Effect.die("expected git.currentBranch result")
			}
			Vitest.assert.strictEqual(backToCurrent.branch, "feature/one")
		})
	)

	it.effect("git.hasUncommittedChanges flips true after a file changes", () =>
		Effect.gen(function*() {
			const fs = yield* FileSystem.FileSystem
			const path = yield* Path.Path
			const dir = yield* freshRepoDir("uncommitted")
			yield* initRepoWithCommit(dir)
			const clean = yield* routeGitCall({ op: "git.hasUncommittedChanges", projectPath: dir })
			Vitest.assert.deepStrictEqual(clean, { op: "git.hasUncommittedChanges", hasUncommittedChanges: false })
			yield* fs.writeFileString(path.join(dir, "readme.txt"), "hello again\n")
			const dirty = yield* routeGitCall({ op: "git.hasUncommittedChanges", projectPath: dir })
			Vitest.assert.deepStrictEqual(dirty, { op: "git.hasUncommittedChanges", hasUncommittedChanges: true })
		})
	)

	it.effect("git.stageFiles, git.panelStatus, git.commit, and git.log round-trip a new file", () =>
		Effect.gen(function*() {
			const fs = yield* FileSystem.FileSystem
			const path = yield* Path.Path
			const dir = yield* freshRepoDir("stage-commit-log")
			yield* initRepoWithCommit(dir)
			yield* fs.writeFileString(path.join(dir, "new.txt"), "new file\n")

			const beforeStage = yield* routeGitCall({ op: "git.panelStatus", projectPath: dir })
			if (beforeStage.op !== "git.panelStatus") {
				return yield* Effect.die("expected git.panelStatus result")
			}
			Vitest.assert.strictEqual(
				beforeStage.files.some((file) => file.path === "new.txt"),
				true
			)

			yield* routeGitCall({ op: "git.stageFiles", projectPath: dir, files: ["new.txt"] })
			const commitResult = yield* routeGitCall({
				op: "git.commit",
				projectPath: dir,
				message: "Add new.txt"
			})
			if (commitResult.op !== "git.commit") {
				return yield* Effect.die("expected git.commit result")
			}
			Vitest.assert.strictEqual(commitResult.sha.length > 0, true)

			const log = yield* routeGitCall({ op: "git.log", projectPath: dir, limit: 5 })
			if (log.op !== "git.log") {
				return yield* Effect.die("expected git.log result")
			}
			Vitest.assert.strictEqual(log.entries[0]?.message, "Add new.txt")
		})
	)

	it.effect("git.unstageFiles and git.discardChanges reverse a staged/unstaged edit", () =>
		Effect.gen(function*() {
			const fs = yield* FileSystem.FileSystem
			const path = yield* Path.Path
			const dir = yield* freshRepoDir("unstage-discard")
			yield* initRepoWithCommit(dir)
			yield* fs.writeFileString(path.join(dir, "readme.txt"), "edited\n")
			yield* routeGitCall({ op: "git.stageAll", projectPath: dir })

			const staged = yield* routeGitCall({ op: "git.panelStatus", projectPath: dir })
			if (staged.op !== "git.panelStatus") {
				return yield* Effect.die("expected git.panelStatus result")
			}
			Vitest.assert.strictEqual(staged.files[0]?.indexStatus, "modified")

			yield* routeGitCall({ op: "git.unstageFiles", projectPath: dir, files: ["readme.txt"] })
			const unstaged = yield* routeGitCall({ op: "git.panelStatus", projectPath: dir })
			if (unstaged.op !== "git.panelStatus") {
				return yield* Effect.die("expected git.panelStatus result")
			}
			Vitest.assert.strictEqual(unstaged.files[0]?.indexStatus, null)

			yield* routeGitCall({ op: "git.discardChanges", projectPath: dir, files: ["readme.txt"] })
			const content = yield* fs.readFileString(path.join(dir, "readme.txt"))
			Vitest.assert.strictEqual(content, "hello\n")
		})
	)

	it.effect(
		"git.push, git.fetch, git.pull, and git.remoteStatus round-trip against a local bare remote",
		() =>
			Effect.gen(function*() {
				const fs = yield* FileSystem.FileSystem
				const path = yield* Path.Path
				const dir = yield* freshRepoDir("push-pull-remote")
				yield* initRepoWithCommit(dir)
				const branch = (
					yield* runGit({
						gitBin: "git",
						args: Arr.fromIterable(["branch", "--show-current"]),
						cwd: dir,
						allowExitCodes: noAllow,
						env: noneEnv
					})
				).trim()

				// A bare repo on the local filesystem stands in for a real remote --
				// no network access needed, and `git remote add`/`push`/`fetch`/`pull`
				// against a local path exercise the exact same code paths as a real
				// origin would.
				const remoteDir = yield* fs.makeTempDirectoryScoped()
				yield* runGit({
					gitBin: "git",
					args: Arr.fromIterable(["init", "--bare"]),
					cwd: remoteDir,
					allowExitCodes: noAllow,
					env: noneEnv
				})
				yield* runGit({
					gitBin: "git",
					args: Arr.fromIterable(["remote", "add", "origin", remoteDir]),
					cwd: dir,
					allowExitCodes: noAllow,
					env: noneEnv
				})
				yield* runGit({
					gitBin: "git",
					args: Arr.fromIterable(["push", "--set-upstream", "origin", branch]),
					cwd: dir,
					allowExitCodes: noAllow,
					env: noneEnv
				})

				const clean = yield* routeGitCall({ op: "git.remoteStatus", projectPath: dir })
				if (clean.op !== "git.remoteStatus") {
					return yield* Effect.die("expected git.remoteStatus result")
				}
				Vitest.assert.strictEqual(clean.ahead, 0)
				Vitest.assert.strictEqual(clean.behind, 0)

				// A local commit puts us ahead; git.push (routed) should clear it.
				yield* fs.writeFileString(path.join(dir, "pushed.txt"), "pushed\n")
				yield* routeGitCall({ op: "git.stageAll", projectPath: dir })
				yield* routeGitCall({ op: "git.commit", projectPath: dir, message: "add pushed.txt" })

				const ahead = yield* routeGitCall({ op: "git.remoteStatus", projectPath: dir })
				if (ahead.op !== "git.remoteStatus") {
					return yield* Effect.die("expected git.remoteStatus result")
				}
				Vitest.assert.strictEqual(ahead.ahead, 1)

				const pushed = yield* routeGitCall({ op: "git.push", projectPath: dir })
				Vitest.assert.deepStrictEqual(pushed, { op: "git.push" })

				const afterPush = yield* routeGitCall({ op: "git.remoteStatus", projectPath: dir })
				if (afterPush.op !== "git.remoteStatus") {
					return yield* Effect.die("expected git.remoteStatus result")
				}
				Vitest.assert.strictEqual(afterPush.ahead, 0)

				// A collaborator clone pushes a commit the local repo doesn't have
				// yet; git.fetch (routed) should surface it as "behind", and
				// git.pull (routed) should bring the file down.
				const collaborator = yield* fs.makeTempDirectoryScoped()
				yield* runGit({
					gitBin: "git",
					args: Arr.fromIterable(["clone", remoteDir, collaborator]),
					cwd: remoteDir,
					allowExitCodes: noAllow,
					env: noneEnv
				})
				yield* configureRepo(collaborator)
				yield* fs.writeFileString(path.join(collaborator, "from-collaborator.txt"), "hi\n")
				yield* runGit({
					gitBin: "git",
					args: Arr.fromIterable(["add", "-A"]),
					cwd: collaborator,
					allowExitCodes: noAllow,
					env: noneEnv
				})
				yield* runGit({
					gitBin: "git",
					args: Arr.fromIterable(["commit", "-m", "collaborator commit"]),
					cwd: collaborator,
					allowExitCodes: noAllow,
					env: noneEnv
				})
				yield* runGit({
					gitBin: "git",
					args: Arr.fromIterable(["push"]),
					cwd: collaborator,
					allowExitCodes: noAllow,
					env: noneEnv
				})

				const fetched = yield* routeGitCall({ op: "git.fetch", projectPath: dir })
				Vitest.assert.deepStrictEqual(fetched, { op: "git.fetch" })

				const behind = yield* routeGitCall({ op: "git.remoteStatus", projectPath: dir })
				if (behind.op !== "git.remoteStatus") {
					return yield* Effect.die("expected git.remoteStatus result")
				}
				Vitest.assert.strictEqual(behind.behind, 1)

				const pulled = yield* routeGitCall({ op: "git.pull", projectPath: dir })
				Vitest.assert.deepStrictEqual(pulled, { op: "git.pull" })

				const gotFile = yield* fs.exists(path.join(dir, "from-collaborator.txt"))
				Vitest.assert.strictEqual(gotFile, true)
			})
	)

	it.effect("git.stashList, git.stashPop, and git.stashDrop round-trip a stashed edit", () =>
		Effect.gen(function*() {
			const fs = yield* FileSystem.FileSystem
			const path = yield* Path.Path
			const git = yield* GitService
			const dir = yield* freshRepoDir("stash")
			yield* initRepoWithCommit(dir)
			yield* fs.writeFileString(path.join(dir, "readme.txt"), "hello\nstashed\n")

			// GitService has no stashSave gitCall op (stashSave has no live caller
			// per tauri-client/git.ts's header comment) -- stash it directly
			// through GitService so the test can drive git.stashList/Pop/Drop.
			yield* git.stashSave({ projectPath: dir, message: "wip" })

			const listed = yield* routeGitCall({ op: "git.stashList", projectPath: dir })
			if (listed.op !== "git.stashList") {
				return yield* Effect.die("expected git.stashList result")
			}
			Vitest.assert.strictEqual(listed.entries.length, 1)
			Vitest.assert.strictEqual(listed.entries[0]?.index, 0)

			const clean = yield* fs.readFileString(path.join(dir, "readme.txt"))
			Vitest.assert.strictEqual(clean, "hello\n")

			const popped = yield* routeGitCall({ op: "git.stashPop", projectPath: dir, index: 0 })
			Vitest.assert.deepStrictEqual(popped, { op: "git.stashPop" })

			const restored = yield* fs.readFileString(path.join(dir, "readme.txt"))
			Vitest.assert.strictEqual(restored, "hello\nstashed\n")

			yield* git.stashSave({ projectPath: dir, message: "wip again" })
			const dropped = yield* routeGitCall({ op: "git.stashDrop", projectPath: dir, index: 0 })
			Vitest.assert.deepStrictEqual(dropped, { op: "git.stashDrop" })

			const afterDrop = yield* routeGitCall({ op: "git.stashList", projectPath: dir })
			if (afterDrop.op !== "git.stashList") {
				return yield* Effect.die("expected git.stashList result")
			}
			Vitest.assert.strictEqual(afterDrop.entries.length, 0)
		})
	)

	it.effect(
		"git.prepareWorktreeSessionLaunch, git.worktreeList, and git.worktreeRemove drive an acepe worktree's lifecycle",
		() =>
			Effect.gen(function*() {
				const dir = yield* freshRepoDir("worktree-lifecycle")
				yield* initRepoWithCommit(dir)

				const prepared = yield* routeGitCall({
					op: "git.prepareWorktreeSessionLaunch",
					projectPath: dir,
					agentId: "agent-1"
				})
				if (prepared.op !== "git.prepareWorktreeSessionLaunch") {
					return yield* Effect.die("expected git.prepareWorktreeSessionLaunch result")
				}
				Vitest.assert.strictEqual(prepared.launch.worktree.origin, "acepe")
				Vitest.assert.strictEqual(prepared.launch.launchToken.length > 0, true)

				const listed = yield* routeGitCall({ op: "git.worktreeList", projectPath: dir })
				if (listed.op !== "git.worktreeList") {
					return yield* Effect.die("expected git.worktreeList result")
				}
				Vitest.assert.strictEqual(
					listed.worktrees.some((wt) => wt.name === prepared.launch.worktree.name),
					true
				)

				const discarded = yield* routeGitCall({
					op: "git.discardPreparedWorktreeSessionLaunch",
					launchToken: prepared.launch.launchToken,
					removeWorktree: true
				})
				Vitest.assert.deepStrictEqual(discarded, {
					op: "git.discardPreparedWorktreeSessionLaunch"
				})

				const afterDiscard = yield* routeGitCall({ op: "git.worktreeList", projectPath: dir })
				if (afterDiscard.op !== "git.worktreeList") {
					return yield* Effect.die("expected git.worktreeList result")
				}
				Vitest.assert.strictEqual(
					afterDiscard.worktrees.some((wt) => wt.name === prepared.launch.worktree.name),
					false
				)
			})
	)

	it.effect(
		"git.worktreeRemove removes a worktree created outside prepareWorktreeSessionLaunch",
		() =>
			Effect.gen(function*() {
				const git = yield* GitService
				const dir = yield* freshRepoDir("worktree-remove")
				yield* initRepoWithCommit(dir)
				const created = yield* git.worktreeCreate(dir)

				const removed = yield* routeGitCall({
					op: "git.worktreeRemove",
					worktreePath: created.directory,
					force: true
				})
				Vitest.assert.deepStrictEqual(removed, { op: "git.worktreeRemove" })

				const listed = yield* routeGitCall({ op: "git.worktreeList", projectPath: dir })
				if (listed.op !== "git.worktreeList") {
					return yield* Effect.die("expected git.worktreeList result")
				}
				Vitest.assert.strictEqual(listed.worktrees.some((wt) => wt.name === created.name), false)
			})
	)

	it.effect(
		"git.saveWorktreeConfig, git.loadWorktreeConfig, and git.runWorktreeSetup round-trip a .acepe.json",
		() =>
			Effect.gen(function*() {
				const dir = yield* freshRepoDir("worktree-config")
				yield* initRepoWithCommit(dir)

				const beforeSave = yield* routeGitCall({ op: "git.loadWorktreeConfig", projectPath: dir })
				Vitest.assert.deepStrictEqual(beforeSave, { op: "git.loadWorktreeConfig", config: null })

				const saved = yield* routeGitCall({
					op: "git.saveWorktreeConfig",
					projectPath: dir,
					setupCommands: ["echo one", "echo two"]
				})
				Vitest.assert.deepStrictEqual(saved, { op: "git.saveWorktreeConfig" })

				const loaded = yield* routeGitCall({ op: "git.loadWorktreeConfig", projectPath: dir })
				Vitest.assert.deepStrictEqual(loaded, {
					op: "git.loadWorktreeConfig",
					config: { setupCommands: ["echo one", "echo two"] }
				})

				const setup = yield* routeGitCall({
					op: "git.runWorktreeSetup",
					worktreePath: dir,
					projectPath: dir
				})
				if (setup.op !== "git.runWorktreeSetup") {
					return yield* Effect.die("expected git.runWorktreeSetup result")
				}
				Vitest.assert.strictEqual(setup.result.success, true)
				Vitest.assert.strictEqual(setup.result.outputs.length, 2)
				Vitest.assert.strictEqual(setup.result.outputs[0]?.stdout.trim(), "one")
			})
	)

	it.effect("git.runStackedAction commits without pushing when action is 'commit'", () =>
		Effect.gen(function*() {
			const fs = yield* FileSystem.FileSystem
			const path = yield* Path.Path
			const dir = yield* freshRepoDir("stacked-commit")
			yield* initRepoWithCommit(dir)
			yield* fs.writeFileString(path.join(dir, "readme.txt"), "hello\nchanged\n")
			yield* routeGitCall({ op: "git.stageAll", projectPath: dir })

			const stacked = yield* routeGitCall({
				op: "git.runStackedAction",
				projectPath: dir,
				action: "commit",
				commitMessage: "stacked commit"
			})
			if (stacked.op !== "git.runStackedAction") {
				return yield* Effect.die("expected git.runStackedAction result")
			}
			Vitest.assert.strictEqual(stacked.result.action, "commit")
			Vitest.assert.strictEqual(stacked.result.commit.status, "created")
			Vitest.assert.strictEqual(stacked.result.push.status, "skipped_not_requested")
			Vitest.assert.strictEqual(stacked.result.pr.status, "skipped_not_requested")
		})
	)

	it.effect("git.collectShipContext returns null with nothing staged, a prompt once something is", () =>
		Effect.gen(function*() {
			const fs = yield* FileSystem.FileSystem
			const path = yield* Path.Path
			const dir = yield* freshRepoDir("ship-context")
			yield* initRepoWithCommit(dir)

			const empty = yield* routeGitCall({ op: "git.collectShipContext", projectPath: dir })
			Vitest.assert.deepStrictEqual(empty, { op: "git.collectShipContext", context: null })

			yield* fs.writeFileString(path.join(dir, "readme.txt"), "hello\nstaged\n")
			yield* routeGitCall({ op: "git.stageAll", projectPath: dir })

			const withDiff = yield* routeGitCall({ op: "git.collectShipContext", projectPath: dir })
			if (withDiff.op !== "git.collectShipContext" || withDiff.context === null) {
				return yield* Effect.die("expected a non-null git.collectShipContext context")
			}
			Vitest.assert.strictEqual(withDiff.context.prompt.length > 0, true)
			Vitest.assert.strictEqual(withDiff.context.stagedSummary.includes("readme.txt"), true)
		})
	)

	it.effect("git.ciJobDetails wraps a non-GitHub detailsUrl into a typed RpcGitCallError", () =>
		Effect.gen(function*() {
			const dir = yield* freshRepoDir("ci-job-bad-url")
			yield* initRepoWithCommit(dir)

			const error = yield* Effect.flip(
				routeGitCall({
					op: "git.ciJobDetails",
					projectPath: dir,
					detailsUrl: "https://example.com/not-a-github-job"
				})
			)
			Vitest.assert.strictEqual(error._tag, "RpcGitCallError")
			if (error._tag === "RpcGitCallError") {
				Vitest.assert.strictEqual(error.op, "git.ciJobDetails")
			}
		})
	)

	it.effect("git.prDetails and git.prChecks read a real, stable merged PR (skips without gh)", () =>
		Effect.gen(function*() {
			if ((yield* ghAvailable()) === false) {
				return
			}
			const dir = yield* freshRepoDir("pr-details-checks")
			yield* addAcepeRemote(dir)

			const details = yield* routeGitCall({ op: "git.prDetails", projectPath: dir, prNumber: 235 })
			if (details.op !== "git.prDetails") {
				return yield* Effect.die("expected git.prDetails result")
			}
			Vitest.assert.strictEqual(details.details.number, 235)
			Vitest.assert.strictEqual(details.details.state, "MERGED")

			const checks = yield* routeGitCall({ op: "git.prChecks", projectPath: dir, prNumber: 235 })
			if (checks.op !== "git.prChecks") {
				return yield* Effect.die("expected git.prChecks result")
			}
			Vitest.assert.strictEqual(checks.checks.prNumber, 235)
			Vitest.assert.strictEqual(checks.checks.headSha.length > 0, true)
		})
	)

	it.effect(
		"git.mergePr routes a real gh failure into a typed RpcGitCallError, no PR touched (skips without gh)",
		() =>
			Effect.gen(function*() {
				if ((yield* ghAvailable()) === false) {
					return
				}
				const dir = yield* freshRepoDir("merge-pr-not-found")
				yield* addAcepeRemote(dir)

				// A PR number nobody will ever create: gh fails safely with no side
				// effects, exercising the routing + error-mapping path without
				// merging anything real.
				const error = yield* Effect.flip(
					routeGitCall({
						op: "git.mergePr",
						projectPath: dir,
						prNumber: 999_999,
						strategy: "squash"
					})
				)
				Vitest.assert.strictEqual(error._tag, "RpcGitCallError")
				if (error._tag === "RpcGitCallError") {
					Vitest.assert.strictEqual(error.op, "git.mergePr")
				}
			})
	)

	it.effect("denies a projectPath outside every known root", () =>
		Effect.gen(function*() {
			const fs = yield* FileSystem.FileSystem
			const outside = yield* fs.makeTempDirectoryScoped()
			const error = yield* Effect.flip(routeGitCall({ op: "git.isRepo", projectPath: outside }))
			Vitest.assert.strictEqual(error._tag, "RpcFsPathDeniedError")
		})
	)

	it.effect("wraps a real git failure into a typed RpcGitCallError carrying the op", () =>
		Effect.gen(function*() {
			const dir = yield* freshRepoDir("git-failure")
			// No repo at dir yet: currentBranch must fail through real git,
			// not succeed with an empty/placeholder value.
			const error = yield* Effect.flip(routeGitCall({ op: "git.currentBranch", projectPath: dir }))
			Vitest.assert.strictEqual(error._tag, "RpcGitCallError")
			if (error._tag === "RpcGitCallError") {
				Vitest.assert.strictEqual(error.op, "git.currentBranch")
				Vitest.assert.strictEqual(error.detail.length > 0, true)
			}
		})
	)
})
