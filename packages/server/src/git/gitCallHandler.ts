import { type GitCallRequest, type GitCallResult, RpcGitCallError } from "@acepe/contracts"
import * as Effect from "effect/Effect"
import * as FileSystem from "effect/FileSystem"
import * as Path from "effect/Path"
import type * as Schema from "effect/Schema"
import { guardFsPath } from "../rpc/fsPathGuard.ts"
import type { GitServiceError } from "./Errors.ts"
import { GitService } from "./Services/GitService.ts"

// Routes the gitCall utility RPC's tagged-union request onto the existing
// GitService (makeGitService.ts already implements nearly all of this
// logic). This slice carries the branch/checkout, stage/commit,
// push/pull/remote-status, and stash sub-domains -- see gitCall.ts's header
// comment and the #249 issue thread's DESIGN DECISION for the full
// sub-domain roadmap.
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
	}
})
