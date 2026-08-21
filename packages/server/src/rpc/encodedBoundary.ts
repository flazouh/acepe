import {
	decodeEventsRequest,
	decodeOrchestrationCommand,
	decodeSnapshotRequest,
	encodeDispatchExit,
	encodeOrchestrationEvent,
	encodeSnapshotExit,
	type RpcDispatchResult,
	type RpcSessionSnapshot
} from "@acepe/contracts"
import * as Effect from "effect/Effect"
import * as Exit from "effect/Exit"
import * as Result from "effect/Result"
import * as Stream from "effect/Stream"
import { OrchestrationEventStore } from "../persistence/Services/OrchestrationEventStore.ts"
import { OrchestrationEngine } from "../orchestration/Services/OrchestrationEngine.ts"
import { ProjectionSnapshotQuery } from "../orchestration/Services/ProjectionSnapshotQuery.ts"
import { eventsFromSequence, toRpcError, toRpcSnapshot } from "./handlers.ts"

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
	const snapshots = yield* ProjectionSnapshotQuery
	const outcome = yield* Effect.result(
		decodeSnapshotRequest(params).pipe(
			Effect.flatMap((request) => snapshots.snapshot(request.sessionId)),
			Effect.map(toRpcSnapshot)
		)
	)
	if (Result.isFailure(outcome)) {
		const rpcError = toRpcError(outcome.failure)
		return yield* rpcError.pipe(Exit.fail, encodeSnapshotExit)
	}
	const snapshot: RpcSessionSnapshot = outcome.success
	return yield* encodeSnapshotExit(Exit.succeed(snapshot))
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
