import {
	type MessageId,
	type MessageSentEvent,
	type OrchestrationEvent,
	type Sequence,
	ApprovalRequestCommand,
	TokenAppendCommand,
	ToolCallObserveCommand,
	TRACER_APPROVAL_TITLE,
	TRACER_REPLY_TOKENS,
	TRACER_TOOL_TITLE,
	tracerActivityId,
	tracerApprovalCommandId,
	tracerApprovalRequestId,
	tracerAssistantMessageId,
	tracerTokenCommandId,
	tracerToolCallId,
	tracerToolCommandId
} from "@acepe/contracts"
import * as Arr from "effect/Array"
import * as Cause from "effect/Cause"
import * as Context from "effect/Context"
import * as Duration from "effect/Duration"
import * as Effect from "effect/Effect"
import * as Fiber from "effect/Fiber"
import * as HashSet from "effect/HashSet"
import * as Layer from "effect/Layer"
import * as Option from "effect/Option"
import * as Queue from "effect/Queue"
import * as Ref from "effect/Ref"
import * as Schema from "effect/Schema"
import * as Stream from "effect/Stream"
import type { SqlError } from "effect/unstable/sql/SqlError"
import { OrchestrationEventStore } from "../persistence/Services/OrchestrationEventStore.ts"
import { OrchestrationEngine } from "../orchestration/Services/OrchestrationEngine.ts"

const EVENT_PAGE_SIZE = 1_000

type EventStoreShape = {
	readonly readFrom: (
		sequence: Sequence,
		limit: number
	) => Stream.Stream<OrchestrationEvent, SqlError | Schema.SchemaError>
}

export class HardcodedProvider extends Context.Service<
	HardcodedProvider,
	{
		readonly idle: Effect.Effect<void>
		readonly waitForReply: (
			userMessageId: MessageId
		) => Effect.Effect<void, SqlError | Schema.SchemaError>
	}
>()("@acepe/server/provider/HardcodedProvider") {}

const readAllFrom = Effect.fn("HardcodedProvider.readAllFrom")(function*(
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

const asMessageSent = (event: OrchestrationEvent): Option.Option<MessageSentEvent> => {
	if (event.type !== "MessageSent") {
		return Option.none()
	}
	return Option.some(event)
}

export const makeHardcodedProvider = Effect.fn("makeHardcodedProvider")(function*(
	tokenDelay: Duration.Duration
) {
	const engine = yield* OrchestrationEngine
	const store = yield* OrchestrationEventStore
	const layerScope = yield* Effect.scope
	const inFlight = yield* Ref.make(0)
	const handled = yield* Ref.make(HashSet.empty<string>())

	const idle = Effect.gen(function*() {
		while (true) {
			const count = yield* Ref.get(inFlight)
			if (count === 0) {
				return
			}
			yield* Effect.sleep(Duration.millis(5))
		}
	})

	const afterDelay = <A, E, R>(program: Effect.Effect<A, E, R>) => {
		if (Duration.toMillis(tokenDelay) > 0) {
			return Effect.sleep(tokenDelay).pipe(Effect.flatMap(() => program))
		}
		return program
	}

	const replyTo = Effect.fn("HardcodedProvider.replyTo")(function*(sent: MessageSentEvent) {
		yield* Ref.update(inFlight, (count) => count + 1)
		const assistantMessageId = tracerAssistantMessageId(sent.payload.messageId)
		yield* Effect.gen(function*() {
			yield* Effect.forEach(
				TRACER_REPLY_TOKENS,
				(token, index) =>
					afterDelay(
						engine.dispatch(
							TokenAppendCommand.make({
								type: "token.append",
								commandId: tracerTokenCommandId(
									sent.payload.sessionId,
									assistantMessageId,
									index
								),
								sessionId: sent.payload.sessionId,
								messageId: assistantMessageId,
								token
							})
						)
					).pipe(
						Effect.catchCause((cause) =>
							Effect.logError(cause.pipe(Cause.pretty)).pipe(
								Effect.annotateLogs({
									sessionId: sent.payload.sessionId,
									messageId: assistantMessageId,
									tokenIndex: index
								})
							)
						)
					),
				{ discard: true }
			)
			yield* afterDelay(
				engine.dispatch(
					ToolCallObserveCommand.make({
						type: "tool.call.observe",
						commandId: tracerToolCommandId(sent.payload.sessionId, assistantMessageId),
						sessionId: sent.payload.sessionId,
						activityId: tracerActivityId(assistantMessageId),
						toolCallId: tracerToolCallId(assistantMessageId),
						operationId: null,
						status: "in_progress",
						title: TRACER_TOOL_TITLE,
						path: null
					})
				)
			).pipe(
				Effect.catchCause((cause) =>
					Effect.logError(cause.pipe(Cause.pretty)).pipe(
						Effect.annotateLogs({
							sessionId: sent.payload.sessionId,
							messageId: assistantMessageId,
							stage: "tool"
						})
					)
				)
			)
			yield* afterDelay(
				engine.dispatch(
					ApprovalRequestCommand.make({
						type: "approval.request",
						commandId: tracerApprovalCommandId(sent.payload.sessionId, assistantMessageId),
						sessionId: sent.payload.sessionId,
						approvalRequestId: tracerApprovalRequestId(assistantMessageId),
						title: TRACER_APPROVAL_TITLE
					})
				)
			).pipe(
				Effect.catchCause((cause) =>
					Effect.logError(cause.pipe(Cause.pretty)).pipe(
						Effect.annotateLogs({
							sessionId: sent.payload.sessionId,
							messageId: assistantMessageId,
							stage: "approval"
						})
					)
				)
			)
		}).pipe(Effect.ensuring(Ref.update(inFlight, (count) => count - 1)))
	})

	const isReplyToken = (userMessageId: MessageId, event: OrchestrationEvent): boolean =>
		event.type === "TokenAppended" &&
		event.payload.messageId === tracerAssistantMessageId(userMessageId)

	const waitForReply = Effect.fn("HardcodedProvider.waitForReply")(function*(
		userMessageId: MessageId
	) {
		yield* Effect.scoped(
			Effect.gen(function*() {
				const liveQueue = yield* Queue.unbounded<OrchestrationEvent, Cause.Done>()
				const listener = yield* engine.streamDomainEvents.pipe(
					Stream.runForEach((event) => Queue.offer(liveQueue, event).pipe(Effect.asVoid)),
					Effect.ensuring(Queue.end(liveQueue).pipe(Effect.asVoid)),
					Effect.forkScoped({ startImmediately: true })
				)
				const replayed = yield* readAllFrom(store, 0)
				const last = Option.match(Arr.last(replayed), {
					onNone: () => 0,
					onSome: (event) => event.sequence
				})
				const historicalCount = Arr.filter(replayed, (event) =>
					isReplyToken(userMessageId, event)
				).length
				if (historicalCount >= TRACER_REPLY_TOKENS.length) {
					yield* Fiber.interrupt(listener)
					return
				}
				const remaining = TRACER_REPLY_TOKENS.length - historicalCount
				yield* Stream.fromQueue(liveQueue).pipe(
					Stream.filter(
						(event) => event.sequence > last && isReplyToken(userMessageId, event)
					),
					Stream.take(remaining),
					Stream.runDrain
				)
				yield* Fiber.interrupt(listener)
			})
		)
	})

	const consider = Effect.fn("HardcodedProvider.consider")(function*(event: OrchestrationEvent) {
		const sent = asMessageSent(event)
		if (Option.isNone(sent)) {
			return
		}
		const claimed = yield* Ref.modify(handled, (set) => {
			if (HashSet.has(set, sent.value.payload.messageId)) {
				return [false, set] as const
			}
			return [true, HashSet.add(set, sent.value.payload.messageId)] as const
		})
		if (!claimed) {
			return
		}
		yield* replyTo(sent.value)
	})

	yield* Effect.forkIn(
		engine.streamDomainEvents.pipe(Stream.runForEach((event) => consider(event))),
		layerScope,
		{ startImmediately: true }
	)
	const historical = yield* readAllFrom(store, 0)
	yield* Effect.forEach(historical, (event) => consider(event), { discard: true })

	return HardcodedProvider.of({ idle, waitForReply })
})

export const HardcodedProviderLive = (tokenDelay: Duration.Duration) =>
	Layer.effect(HardcodedProvider, makeHardcodedProvider(tokenDelay))
