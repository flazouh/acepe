import {
	type OrchestrationEvent,
	MessageId,
	ProjectId,
	SessionId,
	tracerAssistantMessageId
} from "@acepe/contracts"
import * as Vitest from "@effect/vitest"
import type { Done } from "effect/Cause"
import * as Effect from "effect/Effect"
import * as Option from "effect/Option"
import * as Queue from "effect/Queue"
import * as Ref from "effect/Ref"
import * as Schema from "effect/Schema"
import * as Stream from "effect/Stream"
import { makeClaudeAdapter, type ClaudeQueryHandle } from "./ClaudeAdapter.ts"
import { claudePresence } from "./ClaudeProvider.ts"
import { decodeContractFact } from "./ClaudeSdkMap.ts"

type Json = typeof Schema.Json.Type

const sessionId = SessionId.make("session-1")
const projectId = ProjectId.make("project-1")
const messageId = MessageId.make("message-user")

const fakeHandle = (
	inbound: Queue.Queue<Json, Done>,
	interrupts: Ref.Ref<number>
): ClaudeQueryHandle => ({
	messages: Stream.fromQueue(inbound),
	interrupt: Ref.update(interrupts, (count) => count + 1).pipe(Effect.asVoid),
	close: Queue.end(inbound).pipe(Effect.asVoid)
})

Vitest.describe("ClaudeAdapter", () => {
	Vitest.it.effect("emits deferred_open before the SDK session id exists", () =>
		Effect.gen(function*() {
			const inbound = yield* Queue.unbounded<Json, Done>()
			const interrupts = yield* Ref.make(0)
			const adapter = yield* makeClaudeAdapter({
				presence: Effect.succeed(claudePresence(true, true)),
				createQuery: () => Effect.succeed(fakeHandle(inbound, interrupts))
			})
			const events = yield* Queue.unbounded<OrchestrationEvent, Done>()
			yield* adapter
				.startSession({
					sessionId,
					projectId,
					workspaceRoot: "/tmp/acepe"
				})
				.pipe(
					Stream.runForEach((event) => Queue.offer(events, event).pipe(Effect.asVoid)),
					Effect.forkChild({ startImmediately: true })
				)
			const opened = yield* Queue.take(events)
			Vitest.assert.strictEqual(opened.type, "SessionMetaUpdated")
			const fact = decodeContractFact(opened.metadata)
			Vitest.assert.isTrue(Option.isSome(fact))
			if (Option.isSome(fact)) {
				Vitest.assert.strictEqual(fact.value.contractKind, "deferred_open")
				if (fact.value.contractKind === "deferred_open") {
					Vitest.assert.strictEqual(fact.value.canonicalReady, false)
				}
			}
			const sent = yield* Stream.runCollect(
				adapter.sendPrompt({
					sessionId,
					messageId,
					text: "Hello before canonical"
				})
			)
			Vitest.assert.strictEqual(sent[0]?.type, "MessageSent")
			Vitest.assert.strictEqual(sent[0]?.payload.text, "Hello before canonical")
			yield* adapter.cancelTurn({ sessionId })
		})
	)

	Vitest.it.effect("streams TokenAppended from fake transport text deltas", () =>
		Effect.gen(function*() {
			const inbound = yield* Queue.unbounded<Json, Done>()
			const interrupts = yield* Ref.make(0)
			const adapter = yield* makeClaudeAdapter({
				presence: Effect.succeed(claudePresence(true, true)),
				createQuery: () => Effect.succeed(fakeHandle(inbound, interrupts))
			})
			const events = yield* Queue.unbounded<OrchestrationEvent, Done>()
			yield* adapter
				.startSession({
					sessionId,
					projectId,
					workspaceRoot: "/tmp/acepe"
				})
				.pipe(
					Stream.runForEach((event) => Queue.offer(events, event).pipe(Effect.asVoid)),
					Effect.forkChild({ startImmediately: true })
				)
			yield* Queue.take(events)
			yield* Stream.runCollect(
				adapter.sendPrompt({
					sessionId,
					messageId,
					text: "Hi"
				})
			)
			yield* Queue.offer(inbound, {
				type: "stream_event",
				session_id: "sdk-session-1",
				event: {
					type: "content_block_delta",
					delta: {
						type: "text_delta",
						text: "Hello"
					}
				}
			})
			const first = yield* Queue.take(events)
			const tokenEvent =
				first.type === "TokenAppended" ? first : yield* Queue.take(events)
			Vitest.assert.strictEqual(tokenEvent.type, "TokenAppended")
			if (tokenEvent.type === "TokenAppended") {
				Vitest.assert.strictEqual(tokenEvent.payload.token, "Hello")
				Vitest.assert.strictEqual(
					tokenEvent.payload.messageId,
					tracerAssistantMessageId(messageId)
				)
			}
			yield* adapter.cancelTurn({ sessionId })
		})
	)

	Vitest.it.effect("cancelTurn interrupts the fake transport and emits TurnCancelled", () =>
		Effect.gen(function*() {
			const inbound = yield* Queue.unbounded<Json, Done>()
			const interrupts = yield* Ref.make(0)
			const adapter = yield* makeClaudeAdapter({
				presence: Effect.succeed(claudePresence(true, true)),
				createQuery: () => Effect.succeed(fakeHandle(inbound, interrupts))
			})
			const events = yield* Queue.unbounded<OrchestrationEvent, Done>()
			yield* adapter
				.startSession({
					sessionId,
					projectId,
					workspaceRoot: "/tmp/acepe"
				})
				.pipe(
					Stream.runForEach((event) => Queue.offer(events, event).pipe(Effect.asVoid)),
					Effect.forkChild({ startImmediately: true })
				)
			yield* Queue.take(events)
			yield* adapter.cancelTurn({ sessionId })
			const cancelled = yield* Queue.take(events)
			Vitest.assert.strictEqual(cancelled.type, "TurnCancelled")
			Vitest.assert.strictEqual(yield* Ref.get(interrupts), 1)
		})
	)
})
