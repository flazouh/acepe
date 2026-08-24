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
// logic). This slice carries the branch/checkout and stage/commit
// sub-domains only -- see gitCall.ts's header comment and the #249 issue
// thread's DESIGN DECISION for the full sub-domain roadmap.
//
// request.projectPath is confined to a known project root or the app data
// directory (which also contains acepe-managed worktrees, see
// bootstrap.ts's worktreesRoot) via the same guardFsPath the readTextFile/
// writeTextFile RPCs use, so the webview cannot run git against an
// arbitrary directory.

const toRpcGitCallError = (op: string) => (error: GitServiceError | Schema.SchemaError): RpcGitCallError =>
	new RpcGitCallError({ op, detail: error.message })

export const routeGitCall = Effect.fn("routeGitCall")(function*(request: GitCallRequest) {
	const fs = yield* FileSystem.FileSystem
	const path = yield* Path.Path
	const git = yield* GitService
	yield* guardFsPath(fs, path, request.projectPath)

	switch (request.op) {
		case "git.init": {
			yield* git.init(request.projectPath).pipe(Effect.mapError(toRpcGitCallError(request.op)))
			return { op: "git.init" } as const satisfies GitCallResult
		}
		case "git.isRepo": {
			const isRepo = yield* git.isRepo(request.projectPath).pipe(
				Effect.mapError(toRpcGitCallError(request.op))
			)
			return { op: "git.isRepo", isRepo } as const satisfies GitCallResult
		}
		case "git.currentBranch": {
			const branch = yield* git.currentBranch(request.projectPath).pipe(
				Effect.mapError(toRpcGitCallError(request.op))
			)
			return { op: "git.currentBranch", branch } as const satisfies GitCallResult
		}
		case "git.listBranches": {
			const branches = yield* git.listBranches(request.projectPath).pipe(
				Effect.mapError(toRpcGitCallError(request.op))
			)
			return { op: "git.listBranches", branches: Array.from(branches) } as const satisfies GitCallResult
		}
		case "git.checkoutBranch": {
			const branch = yield* git.checkoutBranch({
				projectPath: request.projectPath,
				branch: request.branch,
				...(request.create === undefined ? {} : { create: request.create })
			}).pipe(Effect.mapError(toRpcGitCallError(request.op)))
			return { op: "git.checkoutBranch", branch } as const satisfies GitCallResult
		}
		case "git.hasUncommittedChanges": {
			const hasUncommittedChanges = yield* git.hasUncommittedChanges(request.projectPath).pipe(
				Effect.mapError(toRpcGitCallError(request.op))
			)
			return { op: "git.hasUncommittedChanges", hasUncommittedChanges } as const satisfies GitCallResult
		}
		case "git.panelStatus": {
			const files = yield* git.panelStatus(request.projectPath).pipe(
				Effect.mapError(toRpcGitCallError(request.op))
			)
			return { op: "git.panelStatus", files: Array.from(files) } as const satisfies GitCallResult
		}
		case "git.stageFiles": {
			yield* git.stageFiles({ projectPath: request.projectPath, files: request.files }).pipe(
				Effect.mapError(toRpcGitCallError(request.op))
			)
			return { op: "git.stageFiles" } as const satisfies GitCallResult
		}
		case "git.unstageFiles": {
			yield* git.unstageFiles({ projectPath: request.projectPath, files: request.files }).pipe(
				Effect.mapError(toRpcGitCallError(request.op))
			)
			return { op: "git.unstageFiles" } as const satisfies GitCallResult
		}
		case "git.stageAll": {
			yield* git.stageAll(request.projectPath).pipe(Effect.mapError(toRpcGitCallError(request.op)))
			return { op: "git.stageAll" } as const satisfies GitCallResult
		}
		case "git.discardChanges": {
			yield* git.discardChanges({ projectPath: request.projectPath, files: request.files }).pipe(
				Effect.mapError(toRpcGitCallError(request.op))
			)
			return { op: "git.discardChanges" } as const satisfies GitCallResult
		}
		case "git.commit": {
			const result = yield* git.commit({
				projectPath: request.projectPath,
				message: request.message
			}).pipe(Effect.mapError(toRpcGitCallError(request.op)))
			return { op: "git.commit", sha: result.sha, shortSha: result.shortSha } as const satisfies GitCallResult
		}
		case "git.log": {
			const entries = yield* git.log({
				projectPath: request.projectPath,
				...(request.limit === undefined ? {} : { limit: request.limit })
			}).pipe(Effect.mapError(toRpcGitCallError(request.op)))
			return { op: "git.log", entries: Array.from(entries) } as const satisfies GitCallResult
		}
	}
})
