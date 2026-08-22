import {
	decodeOrchestrationCommand,
	decodeSnapshotRequest,
	encodeOrchestrationEvent,
	encodeRpcSessionSnapshot,
	type OrchestrationCommand,
	type OrchestrationEvent,
	type Sequence
} from "@acepe/contracts"
import {
	decodeRequestLine,
	encodeFailureLine,
	encodeNotificationLine,
	encodeSuccessLine,
	JsonRpcFailure,
	JsonRpcSuccess,
	sidecarNotification
} from "@acepe/sidecar"
import * as Arr from "effect/Array"
import * as Console from "effect/Console"
import * as Duration from "effect/Duration"
import * as Effect from "effect/Effect"
import * as Result from "effect/Result"
import * as Schema from "effect/Schema"
import * as Stdio from "effect/Stdio"
import * as Stream from "effect/Stream"
import * as Str from "effect/String"
import type { SqlError } from "effect/unstable/sql/SqlError"
import { OrchestrationEventStore } from "../persistence/Services/OrchestrationEventStore.ts"
import { OrchestrationEngine } from "../orchestration/Services/OrchestrationEngine.ts"
import { ProjectionSnapshotQuery } from "../orchestration/Services/ProjectionSnapshotQuery.ts"
import { HardcodedProvider } from "../provider/HardcodedProvider.ts"
import { toRpcSnapshot } from "./handlers.ts"

const EVENT_PAGE_SIZE = 1_000
const METHOD_NOT_FOUND = -32601
const INTERNAL_ERROR = -32603

type EventStoreShape = {
	readonly readFrom: (
		sequence: Sequence,
		limit: number
	) => Stream.Stream<OrchestrationEvent, SqlError | Schema.SchemaError>
}

const errorMessage = (error: { readonly message: string }): string => error.message

const readAllFrom = Effect.fn("stdio.readAllFrom")(function*(
	store: EventStoreShape,
	fromSequence: Sequence
) {
	let cursor = fromSequence
	let acc: ReadonlyArray<OrchestrationEvent> = Arr.empty()
	while (true) {
		const page = yield* Stream.runCollect(store.readFrom(cursor, EVENT_PAGE_SIZE))
		if (!Arr.isReadonlyArrayNonEmpty(page)) {
			return acc
		}
		acc = Arr.appendAll(acc, page)
		cursor = Arr.lastNonEmpty(page).sequence
		if (page.length < EVENT_PAGE_SIZE) {
			return acc
		}
	}
})

const failLine = Effect.fn("stdio.failLine")(function*(
	id: string | number | null,
	code: number,
	message: string
) {
	const line = yield* encodeFailureLine(
		yield* Schema.decodeUnknownEffect(JsonRpcFailure)({
			jsonrpc: "2.0",
			id,
			error: {
				code,
				message
			}
		})
	)
	return Arr.of(line)
})

const successLine = Effect.fn("stdio.successLine")(function*(
	id: string | number,
	result: unknown
) {
	const line = yield* encodeSuccessLine(
		yield* Schema.decodeUnknownEffect(JsonRpcSuccess)({
			jsonrpc: "2.0",
			id,
			result
		})
	)
	return line
})

const notificationLine = Effect.fn("stdio.notificationLine")(function*(event: OrchestrationEvent) {
	const payload = yield* encodeOrchestrationEvent(event)
	const notification = yield* sidecarNotification({
		method: "events",
		sessionId: event.aggregateKind === "session" ? event.aggregateId : null,
		seq: event.sequence,
		payload
	})
	return yield* encodeNotificationLine(notification)
})

const dispatchCommand = Effect.fn("stdio.dispatchCommand")(function*(
	id: string | number,
	command: OrchestrationCommand
) {
	const engine = yield* OrchestrationEngine
	const store = yield* OrchestrationEventStore
	const provider = yield* HardcodedProvider
	const before = yield* engine.latestSequence
	const result = yield* engine.dispatch(command)
	if (command.type === "message.send") {
		yield* provider.waitForReply(command.messageId)
	}
	const events = yield* readAllFrom(store, before)
	const notifications = yield* Effect.forEach(events, notificationLine)
	const success = yield* successLine(id, { sequence: result.sequence })
	return Arr.append(notifications, success)
})

export const handleStdioLine = Effect.fn("handleStdioLine")(function*(line: string) {
	if (Str.isEmpty(Str.trim(line))) {
		return Arr.empty<string>()
	}
	const parsed = yield* Effect.result(decodeRequestLine(line))
	if (Result.isFailure(parsed)) {
		return yield* failLine(null, INTERNAL_ERROR, "invalid request")
	}
	const request = parsed.success
	if (request.method === "dispatch") {
		const dispatched = yield* Effect.result(
			decodeOrchestrationCommand(request.params).pipe(
				Effect.flatMap((command) => dispatchCommand(request.id, command))
			)
		)
		if (Result.isFailure(dispatched)) {
			return yield* failLine(request.id, INTERNAL_ERROR, errorMessage(dispatched.failure))
		}
		return dispatched.success
	}
	if (request.method === "snapshot") {
		const snapshotted = yield* Effect.result(
			Effect.gen(function*() {
				const snapshots = yield* ProjectionSnapshotQuery
				const decoded = yield* decodeSnapshotRequest(request.params)
				const snapshot = yield* snapshots.forRequest(decoded)
				const encoded = yield* encodeRpcSessionSnapshot(toRpcSnapshot(snapshot))
				return yield* successLine(request.id, encoded)
			})
		)
		if (Result.isFailure(snapshotted)) {
			return yield* failLine(request.id, INTERNAL_ERROR, errorMessage(snapshotted.failure))
		}
		return Arr.of(snapshotted.success)
	}
	return yield* failLine(request.id, METHOD_NOT_FOUND, `Unknown method '${request.method}'`)
})

export const runStdioServer = Effect.fn("runStdioServer")(function*() {
	const stdio = yield* Stdio.Stdio
	yield* Stream.runForEach(
		stdio.stdin.pipe(Stream.decodeText, Stream.splitLines),
		(line) =>
			handleStdioLine(line).pipe(
				Effect.result,
				Effect.flatMap((outcome) => {
					if (Result.isFailure(outcome)) {
						return failLine(null, INTERNAL_ERROR, errorMessage(outcome.failure))
					}
					return Effect.succeed(outcome.success)
				}),
				Effect.flatMap((lines) =>
					Effect.forEach(lines, (out) => Console.log(out), { discard: true })
				)
			)
	)
})

export const stdioResponseTimeout = Duration.seconds(5)
