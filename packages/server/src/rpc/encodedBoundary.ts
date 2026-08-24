import {
	decodeEventsRequest,
	decodeGetDefaultShellRequest,
	decodeGetProjectIndexRequest,
	decodeGetProviderAccountUsageRequest,
	decodeGitCallRequest,
	decodeInvalidateProjectIndexRequest,
	decodeOrchestrationCommand,
	decodeReadTextFileRequest,
	decodeSnapshotRequest,
	decodeWriteTextFileRequest,
	encodeDispatchExit,
	encodeGetDefaultShellExit,
	encodeGetProjectIndexExit,
	encodeGetProviderAccountUsageExit,
	encodeGitCallExit,
	encodeInvalidateProjectIndexExit,
	encodeOrchestrationEvent,
	encodeReadTextFileExit,
	encodeSnapshotExit,
	encodeWriteTextFileExit,
	RpcSchemaError,
	RpcServerError,
	type RpcDispatchResult,
	type RpcSessionSnapshot
} from "@acepe/contracts"
import * as Effect from "effect/Effect"
import * as Exit from "effect/Exit"
import * as FileSystem from "effect/FileSystem"
import * as Path from "effect/Path"
import * as Result from "effect/Result"
import * as Schema from "effect/Schema"
import * as Stream from "effect/Stream"
import { FileIndexNotADirectoryError, FileIndexRootNotFoundError } from "../fileIndex/Errors.ts"
import { FileIndexService } from "../fileIndex/Services/FileIndexService.ts"
import { getDefaultShell as getDefaultShellUtil } from "../fsUtil/readWriteText.ts"
import { routeGitCall } from "../git/gitCallHandler.ts"
import { OrchestrationEventStore } from "../persistence/Services/OrchestrationEventStore.ts"
import { ProviderUsageService } from "../providerUsage/Services/ProviderUsageService.ts"
import { OrchestrationEngine } from "../orchestration/Services/OrchestrationEngine.ts"
import { dispatchOrchestrationCommand, eventsFromSequence, rpcSnapshotForRequest, toFileIndexRpcError, toRpcError } from "./handlers.ts"
import { guardedReadTextFile, guardedWriteTextFile } from "./fsPathGuard.ts"

const toEncodedFsUtilError = (error: RpcServerError | Schema.SchemaError): RpcServerError => {
	if (Schema.is(RpcServerError)(error)) {
		return error
	}
	return new RpcSchemaError({ issue: error.message })
}

const toEncodedFileIndexError = (error: { readonly message: string }): RpcServerError => {
	if (Schema.is(FileIndexRootNotFoundError)(error)) {
		return toFileIndexRpcError(error)
	}
	if (Schema.is(FileIndexNotADirectoryError)(error)) {
		return toFileIndexRpcError(error)
	}
	return new RpcSchemaError({ issue: error.message })
}

export const encodedDispatch = Effect.fn("encodedDispatch")(function*(params: unknown) {
	const outcome = yield* Effect.result(
		decodeOrchestrationCommand(params).pipe(Effect.flatMap(dispatchOrchestrationCommand))
	)
	if (Result.isFailure(outcome)) {
		const rpcError = toRpcError(outcome.failure)
		return yield* rpcError.pipe(Exit.fail, encodeDispatchExit)
	}
	const result: RpcDispatchResult = { sequence: outcome.success.sequence }
	return yield* encodeDispatchExit(Exit.succeed(result))
})

export const encodedSnapshot = Effect.fn("encodedSnapshot")(function*(params: unknown) {
	const outcome = yield* Effect.result(
		decodeSnapshotRequest(params).pipe(Effect.flatMap(rpcSnapshotForRequest))
	)
	if (Result.isFailure(outcome)) {
		const rpcError = toRpcError(outcome.failure)
		return yield* rpcError.pipe(Exit.fail, encodeSnapshotExit)
	}
	const snapshot: RpcSessionSnapshot = outcome.success
	return yield* encodeSnapshotExit(Exit.succeed(snapshot))
})

export const encodedGetProjectIndex = Effect.fn("encodedGetProjectIndex")(function*(
	params: unknown
) {
	const fileIndex = yield* FileIndexService
	const outcome = yield* Effect.result(
		decodeGetProjectIndexRequest(params).pipe(
			Effect.flatMap((request) => fileIndex.getProjectIndex(request.projectPath))
		)
	)
	if (Result.isFailure(outcome)) {
		const rpcError = toEncodedFileIndexError(outcome.failure)
		return yield* rpcError.pipe(Exit.fail, encodeGetProjectIndexExit)
	}
	return yield* encodeGetProjectIndexExit(Exit.succeed(outcome.success))
})

export const encodedInvalidateProjectIndex = Effect.fn("encodedInvalidateProjectIndex")(function*(
	params: unknown
) {
	const fileIndex = yield* FileIndexService
	const outcome = yield* Effect.result(
		decodeInvalidateProjectIndexRequest(params).pipe(
			Effect.flatMap((request) => fileIndex.invalidate(request.projectPath))
		)
	)
	if (Result.isFailure(outcome)) {
		const rpcError = toEncodedFileIndexError(outcome.failure)
		return yield* rpcError.pipe(Exit.fail, encodeInvalidateProjectIndexExit)
	}
	return yield* encodeInvalidateProjectIndexExit(Exit.void)
})

export const encodedReadTextFile = Effect.fn("encodedReadTextFile")(function*(params: unknown) {
	const fs = yield* FileSystem.FileSystem
	const path = yield* Path.Path
	const outcome = yield* Effect.result(
		decodeReadTextFileRequest(params).pipe(
			Effect.flatMap((request) => guardedReadTextFile(fs, path, request))
		)
	)
	if (Result.isFailure(outcome)) {
		const rpcError = toEncodedFsUtilError(outcome.failure)
		return yield* rpcError.pipe(Exit.fail, encodeReadTextFileExit)
	}
	return yield* encodeReadTextFileExit(Exit.succeed(outcome.success))
})

export const encodedWriteTextFile = Effect.fn("encodedWriteTextFile")(function*(params: unknown) {
	const fs = yield* FileSystem.FileSystem
	const path = yield* Path.Path
	const outcome = yield* Effect.result(
		decodeWriteTextFileRequest(params).pipe(
			Effect.flatMap((request) => guardedWriteTextFile(fs, path, request))
		)
	)
	if (Result.isFailure(outcome)) {
		const rpcError = toEncodedFsUtilError(outcome.failure)
		return yield* rpcError.pipe(Exit.fail, encodeWriteTextFileExit)
	}
	return yield* encodeWriteTextFileExit(Exit.void)
})

export const encodedGetDefaultShell = Effect.fn("encodedGetDefaultShell")(function*(params: unknown) {
	const outcome = yield* Effect.result(
		decodeGetDefaultShellRequest(params).pipe(Effect.flatMap(() => getDefaultShellUtil()))
	)
	if (Result.isFailure(outcome)) {
		const rpcError = toEncodedFsUtilError(outcome.failure)
		return yield* rpcError.pipe(Exit.fail, encodeGetDefaultShellExit)
	}
	return yield* encodeGetDefaultShellExit(Exit.succeed(outcome.success))
})

export const encodedGitCall = Effect.fn("encodedGitCall")(function*(params: unknown) {
	const outcome = yield* Effect.result(
		decodeGitCallRequest(params).pipe(Effect.flatMap(routeGitCall))
	)
	if (Result.isFailure(outcome)) {
		const rpcError = toEncodedFsUtilError(outcome.failure)
		return yield* rpcError.pipe(Exit.fail, encodeGitCallExit)
	}
	return yield* encodeGitCallExit(Exit.succeed(outcome.success))
})

export const encodedGetProviderAccountUsage = Effect.fn("encodedGetProviderAccountUsage")(function*(
	params: unknown
) {
	const providerUsage = yield* ProviderUsageService
	const outcome = yield* Effect.result(
		decodeGetProviderAccountUsageRequest(params).pipe(
			Effect.flatMap((request) => providerUsage.getUsage(request))
		)
	)
	if (Result.isFailure(outcome)) {
		const rpcError = toEncodedFsUtilError(outcome.failure)
		return yield* rpcError.pipe(Exit.fail, encodeGetProviderAccountUsageExit)
	}
	return yield* encodeGetProviderAccountUsageExit(Exit.succeed(outcome.success))
})

export const pushEvents = Effect.fn("pushEvents")(function*(
	params: unknown,
	emit: (payload: unknown) => void
) {
	const engine = yield* OrchestrationEngine
	const store = yield* OrchestrationEventStore
	const request = yield* decodeEventsRequest(params)
	yield* eventsFromSequence(store, engine, request.fromSequence).pipe(
		Stream.runForEach((event) =>
			encodeOrchestrationEvent(event).pipe(
				Effect.mapError(toRpcError),
				Effect.flatMap((payload) => Effect.sync(() => emit(payload)))
			)
		)
	)
})
