import * as Arr from "effect/Array"
import * as Clock from "effect/Clock"
import * as Crypto from "effect/Crypto"
import * as DateTime from "effect/DateTime"
import * as Duration from "effect/Duration"
import * as Effect from "effect/Effect"
import * as Encoding from "effect/Encoding"
import * as FileSystem from "effect/FileSystem"
import * as Filter from "effect/Filter"
import * as HashMap from "effect/HashMap"
import * as Option from "effect/Option"
import * as Path from "effect/Path"
import * as Random from "effect/Random"
import * as Ref from "effect/Ref"
import * as Result from "effect/Result"
import * as Schema from "effect/Schema"
import * as Stream from "effect/Stream"
import * as Str from "effect/String"
import * as ChildProcessSpawner from "effect/unstable/process/ChildProcessSpawner"
import {
	GitAlreadyRepositoryError,
	GitBranchNotMergedError,
	GitCloneDestinationExistsError,
	GitCommandError,
	GitCommitMessageRequiredError,
	GitConfigError,
	GitEmptyCommitMessageError,
	GitInvalidCloneUrlError,
	GitNotARepositoryError,
	GitPathNotFoundError
} from "./Errors.ts"
import {
	parseAheadBehind,
	parseBlame,
	parseGitDiffFiles,
	parseLog,
	parseNumstat,
	parsePorcelain,
	parseShortstat,
	parseStashList,
	parseWorktreePorcelain,
	toFileGitStatus,
	toPanelStatus,
	capitalizeName,
	isCloneUrl,
	lookupNumstat,
	truncateContext,
	type Numstat
} from "./parse.ts"
import { runCommandUsing, runGitUsing } from "./runGit.ts"
import {
	parseCiJob,
	parseGithubJobUrl,
	parseOpenPrList,
	parsePrChecks,
	parsePrDetails,
	parseStepLogs
} from "./ghParse.ts"
import { AcepeConfigFile, type CommandOutput, type WorktreeInfo } from "./Schemas.ts"
import { buildShipPrompt, prBodyWithAcepeFooter } from "./shipPrompt.ts"
import { GitService, type GitServiceShape } from "./Services/GitService.ts"
import { WORKTREE_ADJECTIVES, WORKTREE_NOUNS } from "./worktreeNames.ts"

export type GitServiceLiveOptions = {
	readonly worktreesRoot: string
	readonly gitBin: string
	readonly ghBin: string
}

const noneEnv = Option.none<Readonly<Record<string, string>>>()
const noAllow = Arr.empty<number>()
const diffAllow = Arr.of(1)
const missingAllow = Arr.of(128)
const decodeAcepeConfig = Schema.decodeUnknownEffect(Schema.fromJsonString(AcepeConfigFile))
const encodeAcepeConfig = Schema.encodeUnknownEffect(Schema.fromJsonString(AcepeConfigFile))
const MAX_SUMMARY_BYTES = 8_000
const MAX_PATCH_BYTES = 50_000

const pad2 = (n: number): string => (n < 10 ? `0${String(n)}` : String(n))

const timestampBranch = (now: DateTime.Utc): string => {
	const parts = DateTime.toPartsUtc(now)
	return `acepe/${String(parts.year)}${pad2(parts.month)}${pad2(parts.day)}-${pad2(parts.hour)}${pad2(parts.minute)}${pad2(parts.second)}`
}

export const makeGitService = Effect.fn("GitService.make")(function*(
	options: GitServiceLiveOptions
) {
	const fs = yield* FileSystem.FileSystem
	const path = yield* Path.Path
	const crypto = yield* Crypto.Crypto
	const spawner = yield* ChildProcessSpawner.ChildProcessSpawner
	yield* fs.makeDirectory(options.worktreesRoot, { recursive: true })
	const worktreesRoot = yield* fs.realPath(options.worktreesRoot)
	const launches = yield* Ref.make(HashMap.empty<string, string>())
	const sequence = yield* Ref.make(0)

	const git = Effect.fn("GitService.git")(function*(
		cwd: string,
		args: ReadonlyArray<string>,
		allowExitCodes: ReadonlyArray<number>
	) {
		return yield* runGitUsing(spawner, {
			gitBin: options.gitBin,
			args,
			cwd,
			allowExitCodes,
			env: noneEnv
		})
	})

	const gitCmd = Effect.fn("GitService.gitCmd")(function*(
		cwd: string,
		args: ReadonlyArray<string>,
		allowExitCodes: ReadonlyArray<number>
	) {
		return yield* runCommandUsing(spawner, {
			bin: options.gitBin,
			args,
			cwd,
			allowExitCodes,
			env: noneEnv
		})
	})

	const ghCmd = Effect.fn("GitService.gh")(function*(cwd: string, args: ReadonlyArray<string>) {
		return yield* runCommandUsing(spawner, {
			bin: options.ghBin,
			args,
			cwd,
			allowExitCodes: noAllow,
			env: noneEnv
		}).pipe(
			Effect.timeout(Duration.seconds(30)),
			Effect.catchTag("TimeoutError", () =>
				new GitCommandError({
					bin: options.ghBin,
					args,
					cwd,
					exitCode: 124,
					stderr: "gh command timed out"
				})
			)
		)
	})

	const ensurePath = Effect.fn("GitService.ensurePath")(function*(projectPath: string) {
		const exists = yield* fs.exists(projectPath)
		if (exists === false) {
			return yield* new GitPathNotFoundError({ path: projectPath })
		}
	})

	const isRepo = Effect.fn("GitService.isRepo")(function*(projectPath: string) {
		yield* ensurePath(projectPath)
		const gitMarker = yield* fs.exists(path.join(projectPath, ".git"))
		if (gitMarker === true) {
			return true
		}
		const result = yield* gitCmd(
			projectPath,
			Arr.fromIterable(["rev-parse", "--is-inside-work-tree"]),
			missingAllow
		)
		return result.exitCode === 0 && result.stdout.trim() === "true"
	})

	const ensureRepo = Effect.fn("GitService.ensureRepo")(function*(projectPath: string) {
		const inside = yield* isRepo(projectPath)
		if (inside === false) {
			return yield* new GitNotARepositoryError({ path: projectPath })
		}
	})

	const currentBranch = Effect.fn("GitService.currentBranch")(function*(projectPath: string) {
		yield* ensureRepo(projectPath)
		const shown = (yield* git(projectPath, Arr.fromIterable(["branch", "--show-current"]), noAllow)).trim()
		if (shown !== "") {
			return shown
		}
		const symbolic = yield* gitCmd(
			projectPath,
			Arr.fromIterable(["symbolic-ref", "--short", "HEAD"]),
			missingAllow
		)
		if (symbolic.exitCode === 0 && symbolic.stdout.trim() !== "") {
			return symbolic.stdout.trim()
		}
		return yield* new GitNotARepositoryError({ path: projectPath })
	})

	const currentBranchOption = Effect.fn("GitService.currentBranchOption")(function*(
		projectPath: string
	) {
		const result = yield* Effect.result(currentBranch(projectPath))
		if (Result.isSuccess(result)) {
			return Option.some(result.success)
		}
		return Option.none()
	})

	const porcelain = Effect.fn("GitService.porcelain")(function*(
		projectPath: string,
		untracked: "all" | "normal" | "no"
	) {
		const flag =
			untracked === "all"
				? Arr.fromIterable(["status", "--porcelain=v1", "-uall"])
				: untracked === "no"
					? Arr.fromIterable(["status", "--porcelain=v1", "--untracked-files=no"])
					: Arr.fromIterable(["status", "--porcelain=v1", "--untracked-files=normal"])
		const output = yield* git(projectPath, flag, noAllow)
		return parsePorcelain(output)
	})

	const numstat = Effect.fn("GitService.numstat")(function*(
		projectPath: string,
		cached: boolean
	) {
		const args =
			cached === true
				? Arr.fromIterable(["diff", "--cached", "--numstat"])
				: Arr.fromIterable(["diff", "--numstat"])
		const output = yield* git(projectPath, args, noAllow)
		return parseNumstat(output)
	})

	const untrackedNumstat = Effect.fn("GitService.untrackedNumstat")(function*(
		projectPath: string,
		filePath: string
	) {
		const result = yield* gitCmd(
			projectPath,
			Arr.fromIterable(["diff", "--no-index", "--numstat", "--", "/dev/null", filePath]),
			diffAllow
		)
		return lookupNumstat(parseNumstat(result.stdout), filePath)
	})

	const panelStatus = Effect.fn("GitService.panelStatus")(function*(projectPath: string) {
		yield* ensureRepo(projectPath)
		const entries = yield* porcelain(projectPath, "all")
		const indexStats = yield* numstat(projectPath, true)
		const worktreeStats = yield* numstat(projectPath, false)
		const untracked = Arr.filter(entries, (entry) => entry.worktreeChar === "?")
		const untrackedPairs = yield* Effect.forEach(untracked, (entry) =>
			untrackedNumstat(projectPath, entry.path).pipe(
				Effect.map((stats) => [entry.path, stats] as const)
			)
		)
		const untrackedStats = HashMap.fromIterable(untrackedPairs)
		return Arr.filterMap(
			entries,
			Filter.fromPredicateOption((entry) =>
				toPanelStatus(entry, indexStats, worktreeStats, untrackedStats)
			)
		)
	})

	const projectGitStatus = Effect.fn("GitService.projectGitStatus")(function*(
		projectPath: string,
		untracked: "normal" | "no",
		includeDiffStats: boolean
	) {
		const inside = yield* isRepo(projectPath)
		if (inside === false) {
			return Arr.empty()
		}
		const entries = yield* porcelain(projectPath, untracked)
		const stats = includeDiffStats === true ? yield* numstat(projectPath, false) : HashMap.empty<string, Numstat>()
		return Arr.map(entries, (entry) => toFileGitStatus(entry, stats, includeDiffStats))
	})

	const fileGitStatusSummary = Effect.fn("GitService.fileGitStatusSummary")(function*(
		projectPath: string,
		filePath: string
	) {
		const inside = yield* isRepo(projectPath)
		if (inside === false) {
			return Option.none()
		}
		const output = yield* git(
			projectPath,
			Arr.fromIterable(["status", "--porcelain=v1", "--untracked-files=no", "--", filePath]),
			noAllow
		)
		const entries = parsePorcelain(output)
		return Option.map(Arr.head(entries), (entry) =>
			toFileGitStatus(entry, HashMap.empty<string, Numstat>(), false)
		)
	})

	const projectGitOverview = Effect.fn("GitService.projectGitOverview")(function*(
		projectPath: string
	) {
		yield* ensureRepo(projectPath)
		const branch = yield* currentBranchOption(projectPath)
		const gitStatus = yield* projectGitStatus(projectPath, "normal", true)
		return {
			branch: Option.match(branch, {
				onNone: () => null,
				onSome: (value) => value
			}),
			gitStatus
		}
	})

	const diffStats = Effect.fn("GitService.diffStats")(function*(projectPath: string) {
		yield* ensureRepo(projectPath)
		const unstaged = yield* git(projectPath, Arr.fromIterable(["diff", "--shortstat"]), noAllow)
		const staged = yield* git(
			projectPath,
			Arr.fromIterable(["diff", "--cached", "--shortstat"]),
			noAllow
		)
		const u = parseShortstat(unstaged)
		const s = parseShortstat(staged)
		return {
			insertions: u.insertions + s.insertions,
			deletions: u.deletions + s.deletions,
			filesChanged: u.files + s.files
		}
	})

	const fileDiff = Effect.fn("GitService.fileDiff")(function*(projectPath: string, filePath: string) {
		yield* ensureRepo(projectPath)
		const head = yield* gitCmd(
			projectPath,
			Arr.fromIterable(["show", `HEAD:${filePath}`]),
			missingAllow
		)
		const oldContent = head.exitCode === 0 ? head.stdout : null
		const fullPath = path.join(projectPath, filePath)
		const exists = yield* fs.exists(fullPath)
		const newContent = exists === true ? yield* fs.readFileString(fullPath) : ""
		return {
			oldContent,
			newContent,
			fileName: path.basename(filePath)
		}
	})

	const workingFileDiff = Effect.fn("GitService.workingFileDiff")(function*(input: {
		readonly projectPath: string
		readonly filePath: string
		readonly staged: boolean
		readonly status: string
		readonly additions: number
		readonly deletions: number
	}) {
		yield* ensureRepo(input.projectPath)
		const isUntracked = input.staged === false && input.status === "added"
		const args =
			isUntracked === true
				? Arr.fromIterable(["diff", "--no-index", "--patch", "--", "/dev/null", input.filePath])
				: input.staged === true
					? Arr.fromIterable(["diff", "--cached", "--patch", "--", input.filePath])
					: Arr.fromIterable(["diff", "--patch", "--", input.filePath])
		const result = yield* gitCmd(input.projectPath, args, isUntracked === true ? diffAllow : noAllow)
		const parsed = parseGitDiffFiles(result.stdout)
		const first = Arr.head(parsed)
		const patch = Option.match(first, {
			onNone: () => result.stdout.trim(),
			onSome: (file) => file.patch
		})
		return {
			path: input.filePath,
			status: input.status,
			additions: input.additions,
			deletions: input.deletions,
			patch
		}
	})

	const blame = Effect.fn("GitService.blame")(function*(projectPath: string, filePath: string) {
		yield* ensureRepo(projectPath)
		const output = yield* git(
			projectPath,
			Arr.fromIterable(["blame", "--line-porcelain", "--", filePath]),
			noAllow
		)
		return parseBlame(output)
	})

	const listBranches = Effect.fn("GitService.listBranches")(function*(projectPath: string) {
		yield* ensureRepo(projectPath)
		const worktrees = parseWorktreePorcelain(
			yield* git(projectPath, Arr.fromIterable(["worktree", "list", "--porcelain"]), noAllow)
		)
		const other = Arr.filterMap(
			worktrees,
			Filter.fromPredicateOption((wt) => {
				if (wt.directory === projectPath) {
					return Option.none()
				}
				return wt.branch
			})
		)
		const output = yield* git(
			projectPath,
			Arr.fromIterable(["for-each-ref", "--format=%(refname:short)", "refs/heads"]),
			noAllow
		)
		const names = Arr.filter(output.split("\n"), (line) => line !== "")
		const available = Arr.filter(names, (name) => Arr.contains(other, name) === false)
		return Arr.sort(available, Str.Order)
	})

	const checkoutBranch = Effect.fn("GitService.checkoutBranch")(function*(input: {
		readonly projectPath: string
		readonly branch: string
		readonly create: boolean
	}) {
		yield* ensureRepo(input.projectPath)
		const args =
			input.create === true
				? Arr.fromIterable(["checkout", "-b", input.branch])
				: Arr.fromIterable(["checkout", input.branch])
		yield* git(input.projectPath, args, noAllow)
		return input.branch
	})

	const createBranch = Effect.fn("GitService.createBranch")(function*(input: {
		readonly projectPath: string
		readonly name: string
		readonly startPoint: Option.Option<string>
	}) {
		yield* ensureRepo(input.projectPath)
		const args = Option.match(input.startPoint, {
			onNone: () => Arr.fromIterable(["branch", input.name]),
			onSome: (start) => Arr.fromIterable(["branch", input.name, start])
		})
		yield* git(input.projectPath, args, noAllow)
		return input.name
	})

	const deleteBranch = Effect.fn("GitService.deleteBranch")(function*(input: {
		readonly projectPath: string
		readonly name: string
		readonly force: boolean
	}) {
		yield* ensureRepo(input.projectPath)
		if (input.force === false) {
			const ancestor = yield* gitCmd(
				input.projectPath,
				Arr.fromIterable(["merge-base", "--is-ancestor", input.name, "HEAD"]),
				Arr.of(1)
			)
			if (ancestor.exitCode !== 0) {
				return yield* new GitBranchNotMergedError({ name: input.name })
			}
		}
		const flag = input.force === true ? "-D" : "-d"
		yield* git(input.projectPath, Arr.fromIterable(["branch", flag, input.name]), noAllow)
	})

	const hasUncommittedChanges = Effect.fn("GitService.hasUncommittedChanges")(function*(
		projectPath: string
	) {
		yield* ensureRepo(projectPath)
		const output = yield* git(projectPath, Arr.fromIterable(["status", "--porcelain"]), noAllow)
		return output.trim() !== ""
	})

	const stageFiles = Effect.fn("GitService.stageFiles")(function*(
		projectPath: string,
		files: ReadonlyArray<string>
	) {
		yield* ensureRepo(projectPath)
		if (files.length === 0) {
			return
		}
		yield* git(projectPath, Arr.appendAll(["add", "--"], files), noAllow)
	})

	const unstageFiles = Effect.fn("GitService.unstageFiles")(function*(
		projectPath: string,
		files: ReadonlyArray<string>
	) {
		yield* ensureRepo(projectPath)
		if (files.length === 0) {
			return
		}
		yield* git(projectPath, Arr.appendAll(["reset", "HEAD", "--"], files), noAllow)
	})

	const stageAll = Effect.fn("GitService.stageAll")(function*(projectPath: string) {
		yield* ensureRepo(projectPath)
		yield* git(projectPath, Arr.fromIterable(["add", "-A"]), noAllow)
	})

	const discardChanges = Effect.fn("GitService.discardChanges")(function*(
		projectPath: string,
		files: ReadonlyArray<string>
	) {
		yield* ensureRepo(projectPath)
		const entries = yield* porcelain(projectPath, "all")
		const untracked = HashMap.fromIterable(
			Arr.filterMap(
				entries,
				Filter.fromPredicateOption((entry) =>
					entry.worktreeChar === "?" ? Option.some([entry.path, true] as const) : Option.none()
				)
			)
		)
		const tracked = Arr.filter(files, (file) => HashMap.has(untracked, file) === false)
		const extra = Arr.filter(files, (file) => HashMap.has(untracked, file) === true)
		if (tracked.length > 0) {
			yield* git(projectPath, Arr.appendAll(["checkout", "--"], tracked), noAllow)
		}
		yield* Effect.forEach(
			extra,
			(file) =>
				fs.remove(path.join(projectPath, file), { force: true }).pipe(Effect.asVoid),
			{ discard: true }
		)
	})

	const commit = Effect.fn("GitService.commit")(function*(projectPath: string, message: string) {
		yield* ensureRepo(projectPath)
		if (message.trim() === "") {
			return yield* new GitEmptyCommitMessageError({})
		}
		yield* git(projectPath, Arr.fromIterable(["commit", "-m", message]), noAllow)
		const sha = (yield* git(projectPath, Arr.fromIterable(["rev-parse", "HEAD"]), noAllow)).trim()
		const shortSha = (
			yield* git(projectPath, Arr.fromIterable(["rev-parse", "--short", "HEAD"]), noAllow)
		).trim()
		return {
			sha,
			shortSha
		}
	})

	const hasStagedChanges = Effect.fn("GitService.hasStagedChanges")(function*(projectPath: string) {
		const output = yield* git(
			projectPath,
			Arr.fromIterable(["diff", "--cached", "--name-only"]),
			noAllow
		)
		return output.trim() !== ""
	})

	const remoteStatus = Effect.fn("GitService.remoteStatus")(function*(projectPath: string) {
		yield* ensureRepo(projectPath)
		const upstream = yield* gitCmd(
			projectPath,
			Arr.fromIterable(["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"]),
			missingAllow
		)
		if (upstream.exitCode !== 0) {
			return {
				ahead: 0,
				behind: 0,
				remote: "",
				trackingBranch: ""
			}
		}
		const trackingBranch = upstream.stdout.trim()
		const counts = parseAheadBehind(
			yield* git(
				projectPath,
				Arr.fromIterable(["rev-list", "--left-right", "--count", "HEAD...@{u}"]),
				noAllow
			)
		)
		const remote = trackingBranch.split("/")[0] ?? ""
		return {
			ahead: counts.ahead,
			behind: counts.behind,
			remote,
			trackingBranch
		}
	})

	const stashList = Effect.fn("GitService.stashList")(function*(projectPath: string) {
		yield* ensureRepo(projectPath)
		const output = yield* git(
			projectPath,
			Arr.fromIterable(["stash", "list", "--format=%gd%x09%gs%x09%cr"]),
			noAllow
		)
		return parseStashList(output)
	})

	const log = Effect.fn("GitService.log")(function*(projectPath: string, limit: number) {
		yield* ensureRepo(projectPath)
		const take = limit === 0 ? 50 : limit
		const output = yield* git(
			projectPath,
			Arr.fromIterable(["log", `-n${String(take)}`, "--format=%H%x09%h%x09%s%x09%an%x09%ct"]),
			noAllow
		)
		const nowMs = yield* Clock.currentTimeMillis
		return parseLog(output, Math.floor(nowMs / 1000))
	})

	const collectShipContext = Effect.fn("GitService.collectShipContext")(function*(
		projectPath: string,
		customInstructions: string | undefined
	) {
		yield* ensureRepo(projectPath)
		const summary = yield* git(
			projectPath,
			Arr.fromIterable(["diff", "--cached", "--name-status"]),
			noAllow
		)
		if (summary.trim() === "") {
			return Option.none()
		}
		const patch = yield* git(projectPath, Arr.fromIterable(["diff", "--cached", "--patch"]), noAllow)
		const branch = yield* currentBranch(projectPath)
		return Option.some({
			prompt: buildShipPrompt(
				branch,
				truncateContext(summary, MAX_SUMMARY_BYTES),
				truncateContext(patch, MAX_PATCH_BYTES),
				customInstructions
			),
			branch,
			stagedSummary: truncateContext(summary, MAX_SUMMARY_BYTES)
		})
	})

	const init = Effect.fn("GitService.init")(function*(projectPath: string) {
		yield* ensurePath(projectPath)
		const inside = yield* isRepo(projectPath)
		if (inside === true) {
			return yield* new GitAlreadyRepositoryError({ path: projectPath })
		}
		yield* git(projectPath, Arr.of("init"), noAllow)
	})

	const clone = Effect.fn("GitService.clone")(function*(input: {
		readonly url: string
		readonly destination: string
		readonly branch: Option.Option<string>
	}) {
		if (isCloneUrl(input.url) === false) {
			return yield* new GitInvalidCloneUrlError({ url: input.url })
		}
		const exists = yield* fs.exists(input.destination)
		if (exists === true) {
			return yield* new GitCloneDestinationExistsError({ destination: input.destination })
		}
		const args = Option.match(input.branch, {
			onNone: () => Arr.fromIterable(["clone", input.url, input.destination]),
			onSome: (branch) =>
				Arr.fromIterable(["clone", "--branch", branch, input.url, input.destination])
		})
		yield* git(path.dirname(input.destination), args, noAllow)
		return {
			path: input.destination,
			name: capitalizeName(path.basename(input.destination))
		}
	})

	const projectId = Effect.fn("GitService.projectId")(function*(projectPath: string) {
		const digest = yield* crypto.digest("SHA-256", new TextEncoder().encode(projectPath))
		return Encoding.encodeHex(digest).slice(0, 12)
	})

	const nextWorktreeName = Effect.fn("GitService.nextWorktreeName")(function*(directory: string) {
		let attempt = 0
		while (attempt < 32) {
			const adjIndex = yield* Random.nextIntBetween(0, WORKTREE_ADJECTIVES.length, {
				halfOpen: true
			})
			const nounIndex = yield* Random.nextIntBetween(0, WORKTREE_NOUNS.length, {
				halfOpen: true
			})
			const adjective = WORKTREE_ADJECTIVES[adjIndex] ?? "cosmic"
			const noun = WORKTREE_NOUNS[nounIndex] ?? "falcon"
			const name = `${adjective}-${noun}`
			const candidate = path.join(directory, name)
			const exists = yield* fs.exists(candidate)
			if (exists === false) {
				return name
			}
			attempt = attempt + 1
		}
		return yield* new GitCommandError({
			bin: options.gitBin,
			args: Arr.of("worktree"),
			cwd: directory,
			exitCode: 1,
			stderr: "Failed to generate a unique worktree name"
		})
	})

	const worktreeCreate = Effect.fn("GitService.worktreeCreate")(function*(projectPath: string) {
		yield* ensureRepo(projectPath)
		const id = yield* projectId(projectPath)
		const root = path.join(worktreesRoot, id)
		yield* fs.makeDirectory(root, { recursive: true })
		const name = yield* nextWorktreeName(root)
		const directory = path.join(root, name)
		const base = yield* git(projectPath, Arr.fromIterable(["rev-parse", "--abbrev-ref", "HEAD"]), noAllow)
		yield* git(
			projectPath,
			Arr.fromIterable(["worktree", "add", "-b", name, directory, base.trim()]),
			noAllow
		)
		return {
			name,
			branch: name,
			directory,
			origin: "acepe"
		} satisfies WorktreeInfo
	})

	const worktreeList = Effect.fn("GitService.worktreeList")(function*(projectPath: string) {
		yield* ensureRepo(projectPath)
		const parsed = parseWorktreePorcelain(
			yield* git(projectPath, Arr.fromIterable(["worktree", "list", "--porcelain"]), noAllow)
		)
		return Arr.filterMap(
			parsed,
			Filter.fromPredicateOption((wt) => {
				if (wt.bare === true) {
					return Option.none()
				}
				const name = path.basename(wt.directory)
				const branch = Option.getOrElse(wt.branch, () => name)
				const origin = wt.directory.startsWith(worktreesRoot) ? "acepe" : "external"
				return Option.some({
					name,
					branch,
					directory: wt.directory,
					origin
				} satisfies WorktreeInfo)
			})
		)
	})

	const worktreeRemove = Effect.fn("GitService.worktreeRemove")(function*(
		worktreePath: string,
		force: boolean
	) {
		const args =
			force === true
				? Arr.fromIterable(["worktree", "remove", "--force", worktreePath])
				: Arr.fromIterable(["worktree", "remove", worktreePath])
		yield* git(worktreePath, args, noAllow)
	})

	const worktreeRename = Effect.fn("GitService.worktreeRename")(function*(
		worktreePath: string,
		newName: string
	) {
		const parent = path.dirname(worktreePath)
		const destination = path.join(parent, newName)
		yield* git(worktreePath, Arr.fromIterable(["worktree", "move", worktreePath, destination]), noAllow)
		return {
			name: newName,
			branch: newName,
			directory: destination,
			origin: destination.startsWith(worktreesRoot) ? "acepe" : "external"
		} satisfies WorktreeInfo
	})

	const worktreeReset = Effect.fn("GitService.worktreeReset")(function*(worktreePath: string) {
		yield* ensureRepo(worktreePath)
		yield* gitCmd(worktreePath, Arr.fromIterable(["fetch", "origin", "main"]), missingAllow)
		const candidates = Arr.fromIterable(["origin/main", "origin/master", "main", "master"])
		const found = yield* Effect.reduce(candidates, () => Option.none<string>(), (acc, ref) =>
			Option.match(acc, {
				onSome: (value) => Effect.succeed(Option.some(value)),
				onNone: () =>
					gitCmd(worktreePath, Arr.fromIterable(["rev-parse", "--verify", ref]), missingAllow).pipe(
						Effect.map((result) =>
							result.exitCode === 0 ? Option.some(ref) : Option.none<string>()
						)
					)
			})
		)
		if (Option.isNone(found)) {
			return yield* new GitCommandError({
				bin: options.gitBin,
				args: Arr.fromIterable(["reset", "--hard"]),
				cwd: worktreePath,
				exitCode: 1,
				stderr: "Could not find main/master branch to reset to"
			})
		}
		yield* git(worktreePath, Arr.fromIterable(["reset", "--hard", found.value]), noAllow)
		yield* git(worktreePath, Arr.fromIterable(["clean", "-fd"]), noAllow)
	})

	const worktreeDiskSize = Effect.fn("GitService.worktreeDiskSize")(function*(target: string) {
		yield* ensurePath(target)
		const addSize = Effect.fn("GitService.addSize")(function*(total: number, relative: string) {
			const full = path.join(target, relative)
			const info = yield* fs.stat(full)
			if (info.type === "Directory") {
				return total
			}
			return total + Number(info.size)
		})
		const names = yield* fs.readDirectory(target, { recursive: true })
		return yield* Effect.reduce(names, () => 0, addSize)
	})

	const loadWorktreeConfig = Effect.fn("GitService.loadWorktreeConfig")(function*(
		projectPath: string
	) {
		yield* ensurePath(projectPath)
		const candidates = Arr.fromIterable([
			path.join(projectPath, ".acepe.json"),
			path.join(projectPath, "acepe.config.json")
		])
		for (const file of candidates) {
			const exists = yield* fs.exists(file)
			if (exists === false) {
				continue
			}
			const text = yield* fs.readFileString(file)
			const decoded = yield* decodeAcepeConfig(text).pipe(
				Effect.mapError(
					(error) =>
						new GitConfigError({
							path: file,
							reason: error.message
						})
				)
			)
			return Option.some({
				setupCommands: decoded.worktree?.setupCommands ?? Arr.empty()
			})
		}
		return Option.none()
	})

	const saveWorktreeConfig = Effect.fn("GitService.saveWorktreeConfig")(function*(
		projectPath: string,
		setupCommands: ReadonlyArray<string>
	) {
		yield* ensurePath(projectPath)
		const file = path.join(projectPath, ".acepe.json")
		const text = yield* encodeAcepeConfig({
			worktree: {
				setupCommands
			}
		}).pipe(
			Effect.mapError(
				(error) =>
					new GitConfigError({
						path: file,
						reason: error.message
					})
			)
		)
		yield* fs.writeFileString(file, text)
	})

	const runWorktreeSetup = Effect.fn("GitService.runWorktreeSetup")(function*(
		worktreePath: string,
		projectPath: string
	) {
		const config = yield* loadWorktreeConfig(projectPath)
		const commands = Option.match(config, {
			onNone: () => Arr.empty<string>(),
			onSome: (value) => value.setupCommands
		})
		let outputs: ReadonlyArray<CommandOutput> = Arr.empty()
		for (const command of commands) {
			const result = yield* runCommandUsing(spawner, {
				bin: "sh",
				args: Arr.fromIterable(["-c", command]),
				cwd: worktreePath,
				allowExitCodes: Arr.fromIterable([0, 1]),
				env: noneEnv
			}).pipe(
				Effect.timeout(Duration.seconds(300)),
				Effect.catchTag("TimeoutError", () =>
					Effect.succeed({
						stdout: "",
						stderr: "setup command timed out",
						exitCode: 124
					})
				)
			)
			outputs = Arr.append(outputs, {
				command,
				stdout: result.stdout,
				stderr: result.stderr,
				exitCode: result.exitCode
			})
			if (result.exitCode !== 0) {
				return {
					success: false,
					outputs,
					error: result.stderr.trim() === "" ? `Command failed: ${command}` : result.stderr.trim()
				}
			}
		}
		return {
			success: true,
			outputs,
			error: null
		}
	})

	const prepareWorktreeSessionLaunch = Effect.fn("GitService.prepareWorktreeSessionLaunch")(
		function*(projectPath: string) {
			const worktree = yield* worktreeCreate(projectPath)
			const token = yield* crypto.randomUUIDv4.pipe(
				Effect.mapError(
					() =>
						new GitCommandError({
							bin: options.gitBin,
							args: Arr.of("worktree"),
							cwd: projectPath,
							exitCode: 1,
							stderr: "Failed to generate an event identifier."
						})
				)
			)
			const sequenceId = yield* Ref.updateAndGet(sequence, (n) => n + 1)
			yield* Ref.update(launches, (map) => HashMap.set(map, token, worktree.directory))
			return {
				launchToken: token,
				sequenceId,
				worktree
			}
		}
	)

	const discardPreparedWorktreeSessionLaunch = Effect.fn(
		"GitService.discardPreparedWorktreeSessionLaunch"
	)(function*(launchToken: string, removeWorktree: boolean) {
		const map = yield* Ref.get(launches)
		const directory = HashMap.get(map, launchToken)
		if (Option.isSome(directory) && removeWorktree === true) {
			yield* worktreeRemove(directory.value, true)
		}
		yield* Ref.update(launches, (current) => HashMap.remove(current, launchToken))
	})

	const defaultBranch = Effect.fn("GitService.defaultBranch")(function*(projectPath: string) {
		const result = yield* Effect.result(
			ghCmd(
				projectPath,
				Arr.fromIterable(["repo", "view", "--json", "defaultBranchRef", "--jq", ".defaultBranchRef.name"])
			)
		)
		if (Result.isSuccess(result)) {
			const name = result.success.stdout.trim()
			if (name !== "" && name !== "null") {
				return name
			}
		}
		return "main"
	})

	const getOpenPrForBranch = Effect.fn("GitService.getOpenPrForBranch")(function*(
		projectPath: string
	) {
		yield* ensureRepo(projectPath)
		const branch = yield* currentBranch(projectPath)
		const result = yield* ghCmd(
			projectPath,
			Arr.fromIterable([
				"pr",
				"list",
				"--head",
				branch,
				"--state",
				"open",
				"--limit",
				"1",
				"--json",
				"number,title,url"
			])
		)
		return parseOpenPrList(result.stdout)
	})

	const runStackedAction = Effect.fn("GitService.runStackedAction")(function*(input: {
		readonly projectPath: string
		readonly action: "commit" | "commit_push" | "commit_push_pr"
		readonly commitMessage: string
		readonly prTitle: string | undefined
		readonly prBody: string | undefined
	}) {
		yield* ensureRepo(input.projectPath)
		let branch = yield* currentBranch(input.projectPath)
		const staged = yield* hasStagedChanges(input.projectPath)
		if (staged === true && input.commitMessage.trim() === "") {
			return yield* new GitCommitMessageRequiredError({})
		}
		if (input.action === "commit_push_pr") {
			const base = yield* defaultBranch(input.projectPath)
			if (branch === base) {
				const now = yield* DateTime.now
				const created = timestampBranch(now)
				yield* git(input.projectPath, Arr.fromIterable(["checkout", "-b", created]), noAllow)
				branch = created
			}
		}
		const commitSubject = input.commitMessage.split("\n")[0] ?? input.commitMessage
		const commitStep =
			staged === true
				? yield* commit(input.projectPath, input.commitMessage).pipe(
						Effect.map((result) => ({
							status: "created" as const,
							commitSha: result.sha,
							subject: commitSubject
						}))
					)
				: {
						status: "skipped_no_changes" as const
					}
		const doPush = input.action === "commit_push" || input.action === "commit_push_pr"
		const pushStep =
			doPush === true
				? yield* git(input.projectPath, Arr.of("push"), noAllow).pipe(
						Effect.as({
							status: "pushed" as const,
							branch,
							upstreamBranch: branch
						})
					)
				: {
						status: "skipped_not_requested" as const
					}
		if (input.action !== "commit_push_pr") {
			return {
				action: input.action,
				commit: commitStep,
				push: pushStep,
				pr: {
					status: "skipped_not_requested" as const
				}
			}
		}
		const existing = yield* getOpenPrForBranch(input.projectPath)
		if (Option.isSome(existing)) {
			const base = yield* defaultBranch(input.projectPath)
			return {
				action: input.action,
				commit: commitStep,
				push: pushStep,
				pr: {
					status: "opened_existing" as const,
					url: existing.value.url,
					number: existing.value.number,
					title: existing.value.title,
					baseBranch: base,
					headBranch: branch
				}
			}
		}
		const title = input.prTitle ?? input.commitMessage.split("\n")[0] ?? branch
		const body = prBodyWithAcepeFooter(input.prBody)
		const base = yield* defaultBranch(input.projectPath)
		yield* ghCmd(
			input.projectPath,
			Arr.fromIterable(["pr", "create", "--base", base, "--head", branch, "--title", title, "--body", body])
		)
		const created = yield* getOpenPrForBranch(input.projectPath)
		return {
			action: input.action,
			commit: commitStep,
			push: pushStep,
			pr: Option.match(created, {
				onNone: () => ({
					status: "created" as const,
					title,
					baseBranch: base,
					headBranch: branch
				}),
				onSome: (pr) => ({
					status: "created" as const,
					url: pr.url,
					number: pr.number,
					title: pr.title,
					baseBranch: base,
					headBranch: branch
				})
			})
		}
	})

	const prDetails = Effect.fn("GitService.prDetails")(function*(
		projectPath: string,
		prNumber: number
	) {
		yield* ensureRepo(projectPath)
		const result = yield* ghCmd(
			projectPath,
			Arr.fromIterable([
				"pr",
				"view",
				String(prNumber),
				"--json",
				"number,title,body,state,url,isDraft,additions,deletions,commits,mergedAt"
			])
		)
		return parsePrDetails(result.stdout)
	})

	const prChecks = Effect.fn("GitService.prChecks")(function*(projectPath: string, prNumber: number) {
		yield* ensureRepo(projectPath)
		const result = yield* ghCmd(
			projectPath,
			Arr.fromIterable(["pr", "view", String(prNumber), "--json", "headRefOid,statusCheckRollup"])
		)
		return parsePrChecks(result.stdout, prNumber)
	})

	const mergePr = Effect.fn("GitService.mergePr")(function*(
		projectPath: string,
		prNumber: number,
		strategy: "squash" | "merge" | "rebase"
	) {
		yield* ensureRepo(projectPath)
		const flag =
			strategy === "squash" ? "--squash" : strategy === "rebase" ? "--rebase" : "--merge"
		yield* ghCmd(
			projectPath,
			Arr.fromIterable(["pr", "merge", String(prNumber), flag, "--delete-branch"])
		)
	})

	const ciJobDetails = Effect.fn("GitService.ciJobDetails")(function*(
		projectPath: string,
		detailsUrl: string
	) {
		yield* ensureRepo(projectPath)
		const parsed = parseGithubJobUrl(detailsUrl)
		if (Option.isNone(parsed)) {
			return yield* new GitCommandError({
				bin: options.ghBin,
				args: Arr.of("api"),
				cwd: projectPath,
				exitCode: 1,
				stderr: `Not a GitHub URL: ${detailsUrl}`
			})
		}
		const apiPath = `/repos/${parsed.value.owner}/${parsed.value.repo}/actions/jobs/${String(parsed.value.jobId)}`
		const job = yield* ghCmd(projectPath, Arr.fromIterable(["api", apiPath]))
		const logs = yield* ghCmd(projectPath, Arr.fromIterable(["api", `${apiPath}/logs`]))
		const decoded = parseCiJob(job.stdout, new Map())
		const names = Arr.map(decoded.steps, (step) => step.name)
		return parseCiJob(job.stdout, parseStepLogs(logs.stdout, names))
	})

	const watchHead = (projectPath: string) =>
		Stream.tick(Duration.millis(300)).pipe(
			Stream.mapEffect(() =>
				currentBranchOption(projectPath).pipe(
					Effect.map((branch) => ({
						projectPath,
						branch: Option.match(branch, {
							onNone: () => null,
							onSome: (value) => value
						})
					}))
				)
			)
		)

	return GitService.of({
		isRepo,
		init,
		clone: (input) =>
			clone({
				url: input.url,
				destination: input.destination,
				branch: Option.fromNullishOr(input.branch)
			}),
		currentBranch,
		listBranches,
		checkoutBranch: (input) =>
			checkoutBranch({
				projectPath: input.projectPath,
				branch: input.branch,
				create: input.create === true
			}),
		createBranch: (input) =>
			createBranch({
				projectPath: input.projectPath,
				name: input.name,
				startPoint: Option.fromNullishOr(input.startPoint)
			}),
		deleteBranch: (input) =>
			deleteBranch({
				projectPath: input.projectPath,
				name: input.name,
				force: input.force === true
			}),
		hasUncommittedChanges,
		panelStatus,
		projectGitStatus: (projectPath) => projectGitStatus(projectPath, "normal", true),
		projectGitStatusSummary: (projectPath) => projectGitStatus(projectPath, "no", false),
		fileGitStatusSummary,
		projectGitOverview,
		diffStats,
		fileDiff: (input) => fileDiff(input.projectPath, input.filePath),
		workingFileDiff,
		blame: (input) => blame(input.projectPath, input.filePath),
		stageFiles: (input) => stageFiles(input.projectPath, input.files),
		unstageFiles: (input) => unstageFiles(input.projectPath, input.files),
		stageAll,
		discardChanges: (input) => discardChanges(input.projectPath, input.files),
		commit: (input) => commit(input.projectPath, input.message),
		push: (projectPath) => git(projectPath, Arr.of("push"), noAllow).pipe(Effect.asVoid),
		pull: (projectPath) => git(projectPath, Arr.of("pull"), noAllow).pipe(Effect.asVoid),
		fetch: (projectPath) => git(projectPath, Arr.of("fetch"), noAllow).pipe(Effect.asVoid),
		remoteStatus,
		stashList,
		stashPop: (input) =>
			git(
				input.projectPath,
				Arr.fromIterable(["stash", "pop", `stash@{${String(input.index)}}`]),
				noAllow
			).pipe(Effect.asVoid),
		stashDrop: (input) =>
			git(
				input.projectPath,
				Arr.fromIterable(["stash", "drop", `stash@{${String(input.index)}}`]),
				noAllow
			).pipe(Effect.asVoid),
		stashSave: (input) =>
			git(
				input.projectPath,
				input.message === undefined
					? Arr.fromIterable(["stash", "push"])
					: Arr.fromIterable(["stash", "push", "-m", input.message]),
				noAllow
			).pipe(Effect.asVoid),
		log: (input) => log(input.projectPath, input.limit ?? 50),
		collectShipContext: (input) => collectShipContext(input.projectPath, input.customInstructions),
		runStackedAction: (input) =>
			runStackedAction({
				projectPath: input.projectPath,
				action: input.action,
				commitMessage: input.commitMessage,
				prTitle: input.prTitle,
				prBody: input.prBody
			}),
		worktreeCreate,
		worktreeRemove: (input) => worktreeRemove(input.worktreePath, input.force === true),
		worktreeList,
		worktreeRename: (input) => worktreeRename(input.worktreePath, input.newName),
		worktreeReset,
		worktreeDiskSize,
		prepareWorktreeSessionLaunch: (input) => prepareWorktreeSessionLaunch(input.projectPath),
		discardPreparedWorktreeSessionLaunch: (input) =>
			discardPreparedWorktreeSessionLaunch(input.launchToken, input.removeWorktree === true),
		loadWorktreeConfig,
		saveWorktreeConfig: (input) => saveWorktreeConfig(input.projectPath, input.setupCommands),
		runWorktreeSetup: (input) => runWorktreeSetup(input.worktreePath, input.projectPath),
		prDetails: (input) => prDetails(input.projectPath, input.prNumber),
		prChecks: (input) => prChecks(input.projectPath, input.prNumber),
		mergePr: (input) => mergePr(input.projectPath, input.prNumber, input.strategy),
		getOpenPrForBranch,
		ciJobDetails: (input) => ciJobDetails(input.projectPath, input.detailsUrl),
		watchHead
	} satisfies GitServiceShape)
})
