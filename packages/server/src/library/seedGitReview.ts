import {
	CommandId,
	emptyGitFileDiff,
	GitBlameLoadCommand,
	GitDiffLoadCommand,
	GitStatusRefreshCommand,
	ProjectCreateCommand,
	ProjectId
} from "@acepe/contracts"
import * as Arr from "effect/Array"
import * as Effect from "effect/Effect"
import * as FileSystem from "effect/FileSystem"
import * as Option from "effect/Option"
import * as Path from "effect/Path"
import { fillGitCommand } from "../git/fillCommand.ts"
import { runGit } from "../git/runGit.ts"
import { GitService } from "../git/Services/GitService.ts"
import { OrchestrationEngine } from "../orchestration/Services/OrchestrationEngine.ts"

export const GIT_REVIEW_SEED_PROJECT_ID = ProjectId.make("git-review-project-1")
export const GIT_REVIEW_SEED_ROOT = "/tmp/acepe-git-review-242"
export const GIT_REVIEW_SEED_FILE = "notes.md"

const OLD_NOTES =
	[
		"alpha",
		"bravo",
		"c1",
		"c2",
		"c3",
		"c4",
		"c5",
		"c6",
		"c7",
		"echo",
		"foxtrot",
	].join("\n") + "\n"
export const GIT_REVIEW_SEED_NEW_NOTES =
	[
		"alpha",
		"BRAVO",
		"c1",
		"c2",
		"c3",
		"c4",
		"c5",
		"c6",
		"c7",
		"ECHO",
		"foxtrot",
	].join("\n") + "\n"

const noneEnv = Option.none<Readonly<Record<string, string>>>()
const noAllow = Arr.empty<number>()

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

const prepareFixture = Effect.fn("prepareGitReviewFixture")(function*(root: string) {
	const fs = yield* FileSystem.FileSystem
	const path = yield* Path.Path
	const git = yield* GitService
	if ((yield* fs.exists(root)) === true) {
		yield* fs.remove(root, { recursive: true, force: true })
	}
	yield* fs.makeDirectory(root, { recursive: true })
	yield* git.init(root)
	yield* configureRepo(root)
	yield* fs.writeFileString(path.join(root, GIT_REVIEW_SEED_FILE), OLD_NOTES)
	yield* git.stageAll(root)
	yield* git.commit({
		projectPath: root,
		message: "Seed notes"
	})
	yield* fs.writeFileString(path.join(root, GIT_REVIEW_SEED_FILE), GIT_REVIEW_SEED_NEW_NOTES)
})

export const seedGitReview = Effect.fn("seedGitReview")(function*() {
	const engine = yield* OrchestrationEngine
	yield* prepareFixture(GIT_REVIEW_SEED_ROOT)
	yield* engine.dispatch(
		ProjectCreateCommand.make({
			type: "project.create",
			commandId: CommandId.make("seed-git-review-project"),
			projectId: GIT_REVIEW_SEED_PROJECT_ID,
			title: "Git review",
			workspaceRoot: GIT_REVIEW_SEED_ROOT
		})
	)
	const filledStatus = yield* fillGitCommand(
		GitStatusRefreshCommand.make({
			type: "git.status.refresh",
			commandId: CommandId.make("seed-git-review-status"),
			projectId: GIT_REVIEW_SEED_PROJECT_ID,
			workspaceRoot: GIT_REVIEW_SEED_ROOT,
			status: null
		})
	)
	yield* engine.dispatch(filledStatus)
	const filledDiff = yield* fillGitCommand(
		GitDiffLoadCommand.make({
			type: "git.diff.load",
			commandId: CommandId.make("seed-git-review-diff"),
			projectId: GIT_REVIEW_SEED_PROJECT_ID,
			workspaceRoot: GIT_REVIEW_SEED_ROOT,
			filePath: GIT_REVIEW_SEED_FILE,
			diff: emptyGitFileDiff,
			patch: ""
		})
	)
	yield* engine.dispatch(filledDiff)
	const filledBlame = yield* fillGitCommand(
		GitBlameLoadCommand.make({
			type: "git.blame.load",
			commandId: CommandId.make("seed-git-review-blame"),
			projectId: GIT_REVIEW_SEED_PROJECT_ID,
			workspaceRoot: GIT_REVIEW_SEED_ROOT,
			filePath: GIT_REVIEW_SEED_FILE,
			blame: []
		})
	)
	yield* engine.dispatch(filledBlame)
})
