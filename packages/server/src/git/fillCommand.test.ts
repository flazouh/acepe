import {
	CommandId,
	GitBlameLoadCommand,
	GitDiffLoadCommand,
	GitHunkRejectCommand,
	GitStatusRefreshCommand,
	parseUnifiedHunks,
	ProjectCreateCommand,
	ProjectId,
	TrimmedNonEmptyString
} from "@acepe/contracts"
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
import * as Schema from "effect/Schema"
import { ProjectionGit } from "../persistence/Services/ProjectionGit.ts"
import { fillGitCommand } from "./fillCommand.ts"
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
const commandId = CommandId.make("cmd-git")
const projectId = ProjectId.make("project-1")
const projectorName = Effect.runSync(
	Schema.decodeUnknownEffect(TrimmedNonEmptyString)("projection.git")
)

const StubProjectionGit = Layer.succeed(
	ProjectionGit,
	ProjectionGit.of({
		name: projectorName,
		apply: () => Effect.void,
		truncate: () => Effect.void,
		get: () => Effect.succeed(Option.none())
	})
)

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

const OLD_NOTES =
	["alpha", "bravo", "c1", "c2", "c3", "c4", "c5", "c6", "c7", "echo", "foxtrot"].join("\n") +
	"\n"
const NEW_NOTES =
	["alpha", "BRAVO", "c1", "c2", "c3", "c4", "c5", "c6", "c7", "ECHO", "foxtrot"].join("\n") +
	"\n"
const AFTER_REJECT_HUNK_1 =
	["alpha", "BRAVO", "c1", "c2", "c3", "c4", "c5", "c6", "c7", "echo", "foxtrot"].join("\n") +
	"\n"

const FillLive = (worktreesRoot: string) =>
	Layer.mergeAll(
		gitLayer(worktreesRoot).pipe(Layer.provideMerge(PlatformLive)),
		StubProjectionGit,
		PlatformLive
	)

Vitest.layer(PlatformLive)("fillGitCommand", (it) => {
	it.effect("leaves non-git commands unchanged", () =>
		Effect.gen(function*() {
			const worktrees = yield* FileSystem.FileSystem.pipe(
				Effect.flatMap((fs) => fs.makeTempDirectoryScoped())
			)
			const command = ProjectCreateCommand.make({
				type: "project.create",
				commandId,
				projectId,
				title: "Acepe",
				workspaceRoot: "/tmp/acepe"
			})
			const filled = yield* fillGitCommand(command).pipe(
				// @effect-diagnostics-next-line strictEffectProvide:off
				Effect.provide(FillLive(worktrees))
			)
			Vitest.assert.strictEqual(filled.type, "project.create")
		})
	)

	it.effect("fills status, pierre diff, patch, blame, and rejected newContent", () =>
		Effect.gen(function*() {
			const fs = yield* FileSystem.FileSystem
			const path = yield* Path.Path
			const dir = yield* fs.makeTempDirectoryScoped()
			const worktrees = yield* fs.makeTempDirectoryScoped()
			yield* Effect.gen(function*() {
				const git = yield* GitService
				yield* git.init(dir)
				yield* configureRepo(dir)
				yield* fs.writeFileString(path.join(dir, "notes.md"), OLD_NOTES)
				yield* git.stageAll(dir)
				yield* git.commit({
					projectPath: dir,
					message: "seed notes"
				})
				yield* fs.writeFileString(path.join(dir, "notes.md"), NEW_NOTES)
				const status = yield* fillGitCommand(
					GitStatusRefreshCommand.make({
						type: "git.status.refresh",
						commandId,
						projectId,
						workspaceRoot: dir,
						status: null
					})
				)
				Vitest.assert.strictEqual(status.type, "git.status.refresh")
				if (status.type === "git.status.refresh") {
					Vitest.assert.isNotNull(status.status)
					Vitest.assert.strictEqual(status.status?.[0]?.path, "notes.md")
				}
				const diff = yield* fillGitCommand(
					GitDiffLoadCommand.make({
						type: "git.diff.load",
						commandId,
						projectId,
						workspaceRoot: dir,
						filePath: "notes.md",
						diff: {
							oldContent: null,
							newContent: "",
							fileName: "notes.md"
						},
						patch: ""
					})
				)
				Vitest.assert.strictEqual(diff.type, "git.diff.load")
				if (diff.type === "git.diff.load") {
					Vitest.assert.strictEqual(diff.diff.oldContent, OLD_NOTES)
					Vitest.assert.strictEqual(diff.diff.newContent, NEW_NOTES)
					Vitest.assert.strictEqual(diff.diff.fileName, "notes.md")
					Vitest.assert.strictEqual(parseUnifiedHunks(diff.patch).length, 2)
				}
				const blame = yield* fillGitCommand(
					GitBlameLoadCommand.make({
						type: "git.blame.load",
						commandId,
						projectId,
						workspaceRoot: dir,
						filePath: "notes.md",
						blame: []
					})
				)
				Vitest.assert.strictEqual(blame.type, "git.blame.load")
				if (blame.type === "git.blame.load") {
					Vitest.assert.isAbove(blame.blame.length, 0)
					Vitest.assert.strictEqual(blame.blame[0]?.author, "Test User")
				}
				const rejected = yield* fillGitCommand(
					GitHunkRejectCommand.make({
						type: "git.hunk.reject",
						commandId,
						projectId,
						workspaceRoot: dir,
						filePath: "notes.md",
						hunkIndex: 1,
						newContent: ""
					})
				)
				Vitest.assert.strictEqual(rejected.type, "git.hunk.reject")
				if (rejected.type === "git.hunk.reject") {
					Vitest.assert.strictEqual(rejected.newContent, AFTER_REJECT_HUNK_1)
				}
				const onDisk = yield* fs.readFileString(path.join(dir, "notes.md"))
				Vitest.assert.strictEqual(onDisk, AFTER_REJECT_HUNK_1)
			}).pipe(
				// @effect-diagnostics-next-line strictEffectProvide:off
				Effect.provide(FillLive(worktrees))
			)
		})
	)
})
