import {
	type ReadImageDataUrlRequest,
	type ReadTextFileRequest,
	RpcFsPathDeniedError,
	RpcSchemaError,
	RpcSqlError,
	type RpcServerError,
	type WriteTextFileRequest
} from "@acepe/contracts"
import * as Arr from "effect/Array"
import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import type * as FileSystem from "effect/FileSystem"
import * as Option from "effect/Option"
import type * as Path from "effect/Path"
import * as Schema from "effect/Schema"
import { SqlError } from "effect/unstable/sql/SqlError"
import { readImageDataUrl } from "../fsUtil/readImageDataUrl.ts"
import { readTextFile, writeTextFile } from "../fsUtil/readWriteText.ts"
import { ProjectionProjects } from "../persistence/Services/ProjectionProjects.ts"

// Path confinement for the readTextFile/writeTextFile RPCs: any absolute path
// a webview can send must resolve inside a known project root or the app's
// own data directory. Modeled on the realpath + prefix-containment approach
// in packages/server/src/checkpoint/paths.ts, generalized to walk up to the
// nearest existing ancestor (a write target may not exist yet) and to check
// against multiple candidate roots instead of one project root.

// The directory this running instance's own app data (its sqlite db, etc)
// lives in — the second allowed root, alongside known project roots.
// Provided once at bootstrap from the same filename the persistence layer
// opens for its sqlite db (see bootstrap.ts's makeAcepeLive), not re-derived
// from env vars here, so tests can point it at a scoped temp directory
// instead of a real user data dir.
export interface AppDataDirShape {
	readonly path: string
}
export class AppDataDir extends Context.Service<AppDataDir, AppDataDirShape>()(
	"@acepe/server/rpc/fsPathGuard/AppDataDir"
) {}

const nearestExistingAncestor = Effect.fn("fsPathGuard.nearestExistingAncestor")(function*(
	fs: FileSystem.FileSystem,
	path: Path.Path,
	candidate: string
) {
	let current = candidate
	while (true) {
		const exists = yield* fs.exists(current).pipe(Effect.orElseSucceed(() => false))
		if (exists) {
			return current
		}
		const parent = path.dirname(current)
		if (parent === current) {
			return current
		}
		current = parent
	}
})

const isWithinRoot = (path: Path.Path, candidate: string, root: string): boolean => {
	if (candidate === root) {
		return true
	}
	const prefix = root.endsWith(path.sep) ? root : `${root}${path.sep}`
	return candidate.startsWith(prefix)
}

const toRootsError = (error: SqlError | Schema.SchemaError): RpcServerError =>
	Schema.is(SqlError)(error) ? new RpcSqlError({ reason: error.message }) : new RpcSchemaError({ issue: error.message })

// Project roots come from the projections, the same source other handlers
// (see rpcSnapshotForRequest) read to answer "what projects exist" — this
// list can grow at runtime, so it is re-queried on every call rather than
// cached at layer construction.
export const allowedFsRoots = Effect.fn("fsPathGuard.allowedFsRoots")(function*() {
	const projects = yield* ProjectionProjects
	const list = yield* projects.list().pipe(Effect.mapError(toRootsError))
	const appDataDir = yield* AppDataDir
	return Arr.append(Arr.map(list, (project) => project.workspaceRoot), appDataDir.path)
})

// Fails with RpcFsPathDeniedError unless rawPath resolves inside one of the
// allowed roots. A non-absolute rawPath is left alone: readTextFile/
// writeTextFile already reject those with their own dedicated error.
export const guardFsPath = Effect.fn("fsPathGuard.guardFsPath")(function*(
	fs: FileSystem.FileSystem,
	path: Path.Path,
	rawPath: string
) {
	if (path.isAbsolute(rawPath) === false) {
		return
	}
	const roots = yield* allowedFsRoots()
	const normalized = path.normalize(rawPath)
	const ancestor = yield* nearestExistingAncestor(fs, path, normalized)
	const realAncestor = yield* fs.realPath(ancestor).pipe(
		Effect.mapError(() => new RpcFsPathDeniedError({ path: rawPath }))
	)
	const suffix = normalized.slice(ancestor.length)
	const effective = suffix.length === 0 ? realAncestor : path.join(realAncestor, suffix)

	for (const root of roots) {
		const realRoot = yield* fs.realPath(root).pipe(Effect.option)
		if (Option.isSome(realRoot) && isWithinRoot(path, effective, realRoot.value)) {
			return
		}
	}
	return yield* new RpcFsPathDeniedError({ path: rawPath })
})

// Confinement-checked readTextFile/writeTextFile — the one place both live
// wiring points (rpc/handlers.ts's RpcHandlersLive and
// rpc/encodedBoundary.ts's encodedReadTextFile/encodedWriteTextFile) call
// through, so neither can add a new caller that forgets the guard.
export const guardedReadTextFile = Effect.fn("fsPathGuard.guardedReadTextFile")(function*(
	fs: FileSystem.FileSystem,
	path: Path.Path,
	request: ReadTextFileRequest
) {
	yield* guardFsPath(fs, path, request.path)
	return yield* readTextFile(fs, path, request)
})

export const guardedReadImageDataUrl = Effect.fn("fsPathGuard.guardedReadImageDataUrl")(function*(
	fs: FileSystem.FileSystem,
	path: Path.Path,
	request: ReadImageDataUrlRequest
) {
	yield* guardFsPath(fs, path, request.path)
	return yield* readImageDataUrl(fs, path, request)
})

export const guardedWriteTextFile = Effect.fn("fsPathGuard.guardedWriteTextFile")(function*(
	fs: FileSystem.FileSystem,
	path: Path.Path,
	request: WriteTextFileRequest
) {
	yield* guardFsPath(fs, path, request.path)
	return yield* writeTextFile(fs, path, request)
})
