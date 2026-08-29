import { type GitCallRequest, type GitCallResult, RpcGitCallError } from "@acepe/contracts"
import * as Effect from "effect/Effect"
import * as FileSystem from "effect/FileSystem"
import * as Option from "effect/Option"
import * as Path from "effect/Path"
import type * as Schema from "effect/Schema"
import { guardFsPath } from "../rpc/fsPathGuard.ts"
import type { GitServiceError } from "./Errors.ts"
import { GitService } from "./Services/GitService.ts"

// Routes the gitCall utility RPC's tagged-union request onto the existing
// GitService (makeGitService.ts already implements nearly all of this
// logic, including the ship/PR/CI ops' `gh` shell-outs). This carries every
// live-caller sub-domain: branch/checkout, stage/commit, push/pull/
// remote-status, stash, worktree lifecycle/config, and ship/PR/CI -- see
// gitCall.ts's header comment and the #249 issue thread's DESIGN DECISION.
//
// Every filesystem path a request carries (projectPath, and sub-domain-
// specific paths like worktreePath) is confined to a known project root or
// the app data directory (which also contains acepe-managed worktrees, see
// bootstrap.ts's worktreesRoot) via the same guardFsPath the readTextFile/
// writeTextFile RPCs use, so the webview cannot run git against an
// arbitrary directory. Each switch case guards its own path field(s) --
// unlike a single guard call before the switch, this covers ops with no
// projectPath at all (discardPreparedWorktreeSessionLaunch resolves its
// worktree from a server-trusted token, not a caller-supplied path) and ops
// with more than one path to confine (runWorktreeSetup).

const toRpcGitCallError = (op: string) => (error: GitServiceError | Schema.SchemaError): RpcGitCallError =>
	new RpcGitCallError({ op, detail: error.message })

export const routeGitCall = Effect.fn("routeGitCall")(function*(request: GitCallRequest) {
	const fs = yield* FileSystem.FileSystem
	const path = yield* Path.Path
	const git = yield* GitService
	const guard = (rawPath: string) => guardFsPath(fs, path, rawPath)

	switch (request.op) {
		case "git.init": {
			yield* guard(request.projectPath)
			yield* git.init(request.projectPath).pipe(Effect.mapError(toRpcGitCallError(request.op)))
			return { op: "git.init" } as const satisfies GitCallResult
		}
		case "git.isRepo": {
			yield* guard(request.projectPath)
			const isRepo = yield* git.isRepo(request.projectPath).pipe(
				Effect.mapError(toRpcGitCallError(request.op))
			)
			return { op: "git.isRepo", isRepo } as const satisfies GitCallResult
		}
		case "git.currentBranch": {
			yield* guard(request.projectPath)
			const branch = yield* git.currentBranch(request.projectPath).pipe(
				Effect.mapError(toRpcGitCallError(request.op))
			)
			return { op: "git.currentBranch", branch } as const satisfies GitCallResult
		}
		case "git.headSha": {
			yield* guard(request.projectPath)
			const sha = yield* git.headSha(request.projectPath).pipe(
				Effect.mapError(toRpcGitCallError(request.op))
			)
			return {
				op: "git.headSha",
				sha: Option.isSome(sha) ? sha.value : null
			} as const satisfies GitCallResult
		}
		case "git.listBranches": {
			yield* guard(request.projectPath)
			const branches = yield* git.listBranches(request.projectPath).pipe(
				Effect.mapError(toRpcGitCallError(request.op))
			)
			return { op: "git.listBranches", branches: Array.from(branches) } as const satisfies GitCallResult
		}
		case "git.checkoutBranch": {
			yield* guard(request.projectPath)
			const branch = yield* git.checkoutBranch({
				projectPath: request.projectPath,
				branch: request.branch,
				...(request.create === undefined ? {} : { create: request.create })
			}).pipe(Effect.mapError(toRpcGitCallError(request.op)))
			return { op: "git.checkoutBranch", branch } as const satisfies GitCallResult
		}
		case "git.hasUncommittedChanges": {
			yield* guard(request.projectPath)
			const hasUncommittedChanges = yield* git.hasUncommittedChanges(request.projectPath).pipe(
				Effect.mapError(toRpcGitCallError(request.op))
			)
			return { op: "git.hasUncommittedChanges", hasUncommittedChanges } as const satisfies GitCallResult
		}
		case "git.panelStatus": {
			yield* guard(request.projectPath)
			const files = yield* git.panelStatus(request.projectPath).pipe(
				Effect.mapError(toRpcGitCallError(request.op))
			)
			return { op: "git.panelStatus", files: Array.from(files) } as const satisfies GitCallResult
		}
		case "git.stageFiles": {
			yield* guard(request.projectPath)
			yield* git.stageFiles({ projectPath: request.projectPath, files: request.files }).pipe(
				Effect.mapError(toRpcGitCallError(request.op))
			)
			return { op: "git.stageFiles" } as const satisfies GitCallResult
		}
		case "git.unstageFiles": {
			yield* guard(request.projectPath)
			yield* git.unstageFiles({ projectPath: request.projectPath, files: request.files }).pipe(
				Effect.mapError(toRpcGitCallError(request.op))
			)
			return { op: "git.unstageFiles" } as const satisfies GitCallResult
		}
		case "git.stageAll": {
			yield* guard(request.projectPath)
			yield* git.stageAll(request.projectPath).pipe(Effect.mapError(toRpcGitCallError(request.op)))
			return { op: "git.stageAll" } as const satisfies GitCallResult
		}
		case "git.discardChanges": {
			yield* guard(request.projectPath)
			yield* git.discardChanges({ projectPath: request.projectPath, files: request.files }).pipe(
				Effect.mapError(toRpcGitCallError(request.op))
			)
			return { op: "git.discardChanges" } as const satisfies GitCallResult
		}
		case "git.commit": {
			yield* guard(request.projectPath)
			const result = yield* git.commit({
				projectPath: request.projectPath,
				message: request.message
			}).pipe(Effect.mapError(toRpcGitCallError(request.op)))
			return { op: "git.commit", sha: result.sha, shortSha: result.shortSha } as const satisfies GitCallResult
		}
		case "git.log": {
			yield* guard(request.projectPath)
			const entries = yield* git.log({
				projectPath: request.projectPath,
				...(request.limit === undefined ? {} : { limit: request.limit })
			}).pipe(Effect.mapError(toRpcGitCallError(request.op)))
			return { op: "git.log", entries: Array.from(entries) } as const satisfies GitCallResult
		}
		case "git.push": {
			yield* guard(request.projectPath)
			yield* git.push(request.projectPath).pipe(Effect.mapError(toRpcGitCallError(request.op)))
			return { op: "git.push" } as const satisfies GitCallResult
		}
		case "git.pull": {
			yield* guard(request.projectPath)
			yield* git.pull(request.projectPath).pipe(Effect.mapError(toRpcGitCallError(request.op)))
			return { op: "git.pull" } as const satisfies GitCallResult
		}
		case "git.fetch": {
			yield* guard(request.projectPath)
			yield* git.fetch(request.projectPath).pipe(Effect.mapError(toRpcGitCallError(request.op)))
			return { op: "git.fetch" } as const satisfies GitCallResult
		}
		case "git.remoteStatus": {
			yield* guard(request.projectPath)
			const status = yield* git.remoteStatus(request.projectPath).pipe(
				Effect.mapError(toRpcGitCallError(request.op))
			)
			return {
				op: "git.remoteStatus",
				ahead: status.ahead,
				behind: status.behind,
				remote: status.remote,
				trackingBranch: status.trackingBranch
			} as const satisfies GitCallResult
		}
		case "git.stashList": {
			yield* guard(request.projectPath)
			const entries = yield* git.stashList(request.projectPath).pipe(
				Effect.mapError(toRpcGitCallError(request.op))
			)
			return { op: "git.stashList", entries: Array.from(entries) } as const satisfies GitCallResult
		}
		case "git.stashPop": {
			yield* guard(request.projectPath)
			yield* git.stashPop({ projectPath: request.projectPath, index: request.index }).pipe(
				Effect.mapError(toRpcGitCallError(request.op))
			)
			return { op: "git.stashPop" } as const satisfies GitCallResult
		}
		case "git.stashDrop": {
			yield* guard(request.projectPath)
			yield* git.stashDrop({ projectPath: request.projectPath, index: request.index }).pipe(
				Effect.mapError(toRpcGitCallError(request.op))
			)
			return { op: "git.stashDrop" } as const satisfies GitCallResult
		}
		case "git.worktreeRemove": {
			yield* guard(request.worktreePath)
			yield* git.worktreeRemove({
				worktreePath: request.worktreePath,
				...(request.force === undefined ? {} : { force: request.force })
			}).pipe(Effect.mapError(toRpcGitCallError(request.op)))
			return { op: "git.worktreeRemove" } as const satisfies GitCallResult
		}
		case "git.worktreeList": {
			yield* guard(request.projectPath)
			const worktrees = yield* git.worktreeList(request.projectPath).pipe(
				Effect.mapError(toRpcGitCallError(request.op))
			)
			return {
				op: "git.worktreeList",
				worktrees: Array.from(worktrees)
			} as const satisfies GitCallResult
		}
		case "git.prepareWorktreeSessionLaunch": {
			yield* guard(request.projectPath)
			const launch = yield* git.prepareWorktreeSessionLaunch({
				projectPath: request.projectPath,
				agentId: request.agentId
			}).pipe(Effect.mapError(toRpcGitCallError(request.op)))
			return { op: "git.prepareWorktreeSessionLaunch", launch } as const satisfies GitCallResult
		}
		case "git.discardPreparedWorktreeSessionLaunch": {
			// No path field to guard: the worktree directory this discards is
			// resolved server-side from the launchToken (see makeGitService.ts's
			// `launches` Ref, populated only by a prior, already-guarded
			// prepareWorktreeSessionLaunch call), not from caller-supplied input.
			yield* git.discardPreparedWorktreeSessionLaunch({
				launchToken: request.launchToken,
				...(request.removeWorktree === undefined ? {} : { removeWorktree: request.removeWorktree })
			}).pipe(Effect.mapError(toRpcGitCallError(request.op)))
			return { op: "git.discardPreparedWorktreeSessionLaunch" } as const satisfies GitCallResult
		}
		case "git.loadWorktreeConfig": {
			yield* guard(request.projectPath)
			const config = yield* git.loadWorktreeConfig(request.projectPath).pipe(
				Effect.mapError(toRpcGitCallError(request.op))
			)
			return {
				op: "git.loadWorktreeConfig",
				config: Option.isSome(config) ? config.value : null
			} as const satisfies GitCallResult
		}
		case "git.saveWorktreeConfig": {
			yield* guard(request.projectPath)
			yield* git.saveWorktreeConfig({
				projectPath: request.projectPath,
				setupCommands: request.setupCommands
			}).pipe(Effect.mapError(toRpcGitCallError(request.op)))
			return { op: "git.saveWorktreeConfig" } as const satisfies GitCallResult
		}
		case "git.runWorktreeSetup": {
			yield* guard(request.worktreePath)
			yield* guard(request.projectPath)
			const result = yield* git.runWorktreeSetup({
				worktreePath: request.worktreePath,
				projectPath: request.projectPath
			}).pipe(Effect.mapError(toRpcGitCallError(request.op)))
			return {
				op: "git.runWorktreeSetup",
				result: { success: result.success, outputs: Array.from(result.outputs), error: result.error }
			} as const satisfies GitCallResult
		}
		case "git.runStackedAction": {
			yield* guard(request.projectPath)
			const result = yield* git.runStackedAction({
				projectPath: request.projectPath,
				action: request.action,
				commitMessage: request.commitMessage,
				...(request.prTitle === undefined ? {} : { prTitle: request.prTitle }),
				...(request.prBody === undefined ? {} : { prBody: request.prBody })
			}).pipe(Effect.mapError(toRpcGitCallError(request.op)))
			return { op: "git.runStackedAction", result } as const satisfies GitCallResult
		}
		case "git.collectShipContext": {
			yield* guard(request.projectPath)
			const context = yield* git.collectShipContext({
				projectPath: request.projectPath,
				...(request.customInstructions === undefined ? {} : { customInstructions: request.customInstructions })
			}).pipe(Effect.mapError(toRpcGitCallError(request.op)))
			return {
				op: "git.collectShipContext",
				context: Option.isSome(context) ? context.value : null
			} as const satisfies GitCallResult
		}
		case "git.prDetails": {
			yield* guard(request.projectPath)
			const details = yield* git.prDetails({
				projectPath: request.projectPath,
				prNumber: request.prNumber
			}).pipe(Effect.mapError(toRpcGitCallError(request.op)))
			return { op: "git.prDetails", details } as const satisfies GitCallResult
		}
		case "git.prChecks": {
			yield* guard(request.projectPath)
			const checks = yield* git.prChecks({
				projectPath: request.projectPath,
				prNumber: request.prNumber
			}).pipe(Effect.mapError(toRpcGitCallError(request.op)))
			return { op: "git.prChecks", checks } as const satisfies GitCallResult
		}
		case "git.mergePr": {
			yield* guard(request.projectPath)
			yield* git.mergePr({
				projectPath: request.projectPath,
				prNumber: request.prNumber,
				strategy: request.strategy
			}).pipe(Effect.mapError(toRpcGitCallError(request.op)))
			return { op: "git.mergePr" } as const satisfies GitCallResult
		}
		case "git.ciJobDetails": {
			yield* guard(request.projectPath)
			const details = yield* git.ciJobDetails({
				projectPath: request.projectPath,
				detailsUrl: request.detailsUrl
			}).pipe(Effect.mapError(toRpcGitCallError(request.op)))
			return { op: "git.ciJobDetails", details } as const satisfies GitCallResult
		}
		case "git.repoContext": {
			yield* guard(request.projectPath)
			const context = yield* git.repoContext(request.projectPath).pipe(
				Effect.mapError(toRpcGitCallError(request.op))
			)
			return { op: "git.repoContext", context } as const satisfies GitCallResult
		}
		case "git.commitDiff": {
			yield* guard(request.projectPath)
			const diff = yield* git.commitDiff({
				projectPath: request.projectPath,
				sha: request.sha
			}).pipe(Effect.mapError(toRpcGitCallError(request.op)))
			return {
				op: "git.commitDiff",
				diff: { ...diff, files: Array.from(diff.files) }
			} as const satisfies GitCallResult
		}
		case "git.prDiff": {
			yield* guard(request.projectPath)
			const diff = yield* git.prDiff({
				projectPath: request.projectPath,
				owner: request.owner,
				repo: request.repo,
				prNumber: request.prNumber
			}).pipe(Effect.mapError(toRpcGitCallError(request.op)))
			return {
				op: "git.prDiff",
				diff: { ...diff, files: Array.from(diff.files) }
			} as const satisfies GitCallResult
		}
		case "git.listPullRequests": {
			yield* guard(request.projectPath)
			const pullRequests = yield* git.listPullRequests({
				projectPath: request.projectPath,
				owner: request.owner,
				repo: request.repo,
				state: request.state,
				limit: request.limit
			}).pipe(Effect.mapError(toRpcGitCallError(request.op)))
			return {
				op: "git.listPullRequests",
				pullRequests: Array.from(pullRequests)
			} as const satisfies GitCallResult
		}
		case "git.workingFileDiff": {
			yield* guard(request.projectPath)
			const diff = yield* git.workingFileDiff({
				projectPath: request.projectPath,
				filePath: request.filePath,
				staged: request.staged,
				status: request.status,
				additions: request.additions,
				deletions: request.deletions
			}).pipe(Effect.mapError(toRpcGitCallError(request.op)))
			// GitService echoes the caller's status back as a plain string;
			// the result union wants the four-way literal, and the request
			// already carries it narrowed.
			return {
				op: "git.workingFileDiff",
				diff: { ...diff, status: request.status }
			} as const satisfies GitCallResult
		}
	}
})
