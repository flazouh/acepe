import {
	decodeEventsRequest,
	decodeGetProjectIndexRequest,
	decodeInvalidateProjectIndexRequest,
	decodeOrchestrationCommand,
	decodeSnapshotRequest,
	encodeDispatchExit,
	encodeGetProjectIndexExit,
	encodeInvalidateProjectIndexExit,
	encodeOrchestrationEvent,
	encodeSnapshotExit,
	RpcSchemaError,
	type RpcDispatchResult,
	type RpcServerError,
	type RpcSessionSnapshot
} from "@acepe/contracts"
import * as Effect from "effect/Effect"
import * as Exit from "effect/Exit"
import * as Result from "effect/Result"
import * as Schema from "effect/Schema"
import * as Stream from "effect/Stream"
import { FileIndexNotADirectoryError, FileIndexRootNotFoundError } from "../fileIndex/Errors.ts"
import { FileIndexService } from "../fileIndex/Services/FileIndexService.ts"
import { OrchestrationEventStore } from "../persistence/Services/OrchestrationEventStore.ts"
import { OrchestrationEngine } from "../orchestration/Services/OrchestrationEngine.ts"
import { eventsFromSequence, rpcSnapshotForRequest, toFileIndexRpcError, toRpcError } from "./handlers.ts"

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
	const engine = yield* OrchestrationEngine
	const outcome = yield* Effect.result(
		decodeOrchestrationCommand(params).pipe(Effect.flatMap((command) => engine.dispatch(command)))
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
