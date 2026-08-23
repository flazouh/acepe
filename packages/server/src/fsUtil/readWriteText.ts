import { RpcSchemaError, type ReadTextFileRequest, type WriteTextFileRequest } from "@acepe/contracts"
import * as Config from "effect/Config"
import * as Effect from "effect/Effect"
import * as FileSystem from "effect/FileSystem"
import * as Option from "effect/Option"
import * as Path from "effect/Path"
import { defaultShell } from "../terminal/shellEnv.ts"

const notAbsolute = (rawPath: string): RpcSchemaError =>
	new RpcSchemaError({ issue: `Path must be absolute: ${rawPath}` })

const cannotAccess = (rawPath: string): RpcSchemaError =>
	new RpcSchemaError({ issue: `Cannot access path: ${rawPath}` })

const readFailed = (rawPath: string): RpcSchemaError =>
	new RpcSchemaError({ issue: `Failed to read file: ${rawPath}` })

const writeFailed = (rawPath: string): RpcSchemaError =>
	new RpcSchemaError({ issue: `Failed to write file: ${rawPath}` })

const parentDirFailed = (parentPath: string): RpcSchemaError =>
	new RpcSchemaError({ issue: `Failed to create parent directories: ${parentPath}` })

// line is 1-based, matching the ACP fs/read_text_file protocol. limit caps the
// number of lines returned, starting at line.
export const applyLinePagination = (
	content: string,
	line: number | undefined,
	limit: number | undefined
): string => {
	if (line === undefined && limit === undefined) {
		return content
	}
	const lines = content.split("\n")
	const startIndex = line === undefined ? 0 : Math.max(0, line - 1)
	const sliced = limit === undefined ? lines.slice(startIndex) : lines.slice(startIndex, startIndex + limit)
	return sliced.join("\n")
}

export const readTextFile = Effect.fn("fsUtil.readTextFile")(function*(
	fs: FileSystem.FileSystem,
	path: Path.Path,
	request: ReadTextFileRequest
) {
	if (path.isAbsolute(request.path) === false) {
		return yield* notAbsolute(request.path)
	}
	const realPath = yield* fs.realPath(request.path).pipe(
		Effect.mapError(() => cannotAccess(request.path))
	)
	const content = yield* fs.readFileString(realPath).pipe(
		Effect.mapError(() => readFailed(request.path))
	)
	return applyLinePagination(content, request.line, request.limit)
})

// Path confinement (project root or app data dir) is enforced by the RPC
// handler layer before this runs — see packages/server/src/rpc/fsPathGuard.ts,
// wired in packages/server/src/rpc/handlers.ts and
// packages/server/src/rpc/encodedBoundary.ts. The client-supplied sessionId
// here is kept for correlation/logging only, not as a write boundary.
export const writeTextFile = Effect.fn("fsUtil.writeTextFile")(function*(
	fs: FileSystem.FileSystem,
	path: Path.Path,
	request: WriteTextFileRequest
) {
	if (path.isAbsolute(request.path) === false) {
		return yield* notAbsolute(request.path)
	}
	yield* Effect.logDebug("fsUtil.writeTextFile", {
		path: request.path,
		sessionId: request.sessionId,
		contentLength: request.content.length
	})
	const parentDir = path.dirname(request.path)
	yield* fs.makeDirectory(parentDir, { recursive: true }).pipe(
		Effect.mapError(() => parentDirFailed(parentDir))
	)
	yield* fs.writeFileString(request.path, request.content).pipe(
		Effect.mapError(() => writeFailed(request.path))
	)
})

const envOption = (name: string) =>
	Config.option(Config.string(name)).pipe(Effect.orElseSucceed(() => Option.none<string>()))

export const getDefaultShell = Effect.fn("fsUtil.getDefaultShell")(function*() {
	const comspec = yield* envOption("COMSPEC")
	const shell = yield* envOption("SHELL")
	return defaultShell(comspec, shell)
})
