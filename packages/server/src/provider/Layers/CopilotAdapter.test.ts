import {
	type OrchestrationEvent,
	MessageId,
	ProjectId,
	SessionId,
	tracerAssistantMessageId
} from "@acepe/contracts"
import * as Vitest from "@effect/vitest"
import type { Done } from "effect/Cause"
import * as Arr from "effect/Array"
import * as Deferred from "effect/Deferred"
import * as Effect from "effect/Effect"
import * as Option from "effect/Option"
import * as Queue from "effect/Queue"
import * as Ref from "effect/Ref"
import * as Schema from "effect/Schema"
import * as Stream from "effect/Stream"
import { decodeContractFact } from "./CopilotAcpMap.ts"
import {
	makeCopilotAdapter,
	type CopilotAcpHandle,
	type CopilotAcpRequest
} from "./CopilotAdapter.ts"
import { copilotPresence } from "./CopilotProvider.ts"

type Json = typeof Schema.Json.Type

const sessionId = SessionId.make("session-1")
const projectId = ProjectId.make("project-1")
const messageId = MessageId.make("message-user")
const steerMessageId = MessageId.make("message-steer")

const fakeHandle = (input: {
	readonly inbound: Queue.Queue<Json, Done>
	readonly recorded: Ref.Ref<ReadonlyArray<CopilotAcpRequest>>
	readonly promptDone: Deferred.Deferred<Json>
	readonly cancels: Ref.Ref<number>
}): CopilotAcpHandle => ({
	notifications: Stream.fromQueue(input.inbound),
	request: (method, params) =>
		Effect.gen(function*() {
			yield* Ref.update(input.recorded, (current) =>
				Arr.append(current, { method, params })
			)
			if (method === "session/new") {
				return { sessionId: "acp-copilot-1" }
			}
			if (method === "session/prompt") {
				return yield* Deferred.await(input.promptDone)
			}
			return {}
		}),
	notify: (method, params) =>
		Ref.update(input.recorded, (current) => Arr.append(current, { method, params })).pipe(
			Effect.flatMap(() =>
				method === "session/cancel"
					? Ref.update(input.cancels, (count) => count + 1)
					: Effect.void
			),
			Effect.asVoid
		),
	close: Queue.end(input.inbound).pipe(Effect.asVoid)
})

const takeUntil = Effect.fn("takeUntil")(function*(
	events: Queue.Queue<OrchestrationEvent, Done>,
	match: (event: OrchestrationEvent) => boolean
) {
	while (true) {
		const event = yield* Queue.take(events)
		if (match(event)) {
			return event
		}
	}
})

Vitest.describe("CopilotAdapter", () => {
	Vitest.it.effect("opens a session through ACP session/new with empty mcpServers", () =>
		Effect.gen(function*() {
			const inbound = yield* Queue.unbounded<Json, Done>()
			const recorded = yield* Ref.make<ReadonlyArray<CopilotAcpRequest>>(Arr.empty())
			const promptDone = yield* Deferred.make<Json>()
			const cancels = yield* Ref.make(0)
			const adapter = yield* makeCopilotAdapter({
				presence: Effect.succeed(copilotPresence(true, true)),
				createTransport: () =>
					Effect.succeed(fakeHandle({ inbound, recorded, promptDone, cancels }))
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
			if (Option.isSome(fact) && fact.value.contractKind === "provider_session") {
				Vitest.assert.strictEqual(fact.value.providerSessionId, "acp-copilot-1")
			}
			const requests = yield* Ref.get(recorded)
			const sessionNew = Arr.findFirst(requests, (request) => request.method === "session/new")
			Vitest.assert.isTrue(Option.isSome(sessionNew))
			if (Option.isSome(sessionNew)) {
				Vitest.assert.deepStrictEqual(sessionNew.value.params, {
					cwd: "/tmp/acepe",
					mcpServers: Arr.empty()
				})
			}
			yield* adapter.cancelTurn({ sessionId })
			yield* Queue.end(inbound)
		})
	)

	Vitest.it.effect("streams TokenAppended from ACP agent_message_chunk updates", () =>
		Effect.gen(function*() {
			const inbound = yield* Queue.unbounded<Json, Done>()
			const recorded = yield* Ref.make<ReadonlyArray<CopilotAcpRequest>>(Arr.empty())
			const promptDone = yield* Deferred.make<Json>()
			const cancels = yield* Ref.make(0)
			const adapter = yield* makeCopilotAdapter({
				presence: Effect.succeed(copilotPresence(true, true)),
				createTransport: () =>
					Effect.succeed(fakeHandle({ inbound, recorded, promptDone, cancels }))
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
			const sent = yield* Stream.runCollect(
				adapter.sendPrompt({
					sessionId,
					messageId,
					text: "Hi"
				})
			)
			Vitest.assert.strictEqual(sent[0]?.type, "MessageSent")
			yield* Queue.offer(inbound, {
				sessionUpdate: "agent_message_chunk",
				content: { type: "text", text: "Hello" }
			})
			const tokenEvent = yield* takeUntil(events, (event) => event.type === "TokenAppended")
			if (tokenEvent.type === "TokenAppended") {
				Vitest.assert.strictEqual(tokenEvent.payload.token, "Hello")
				Vitest.assert.strictEqual(
					tokenEvent.payload.messageId,
					tracerAssistantMessageId(messageId)
				)
			}
			yield* Deferred.succeed(promptDone, { stopReason: "end_turn" })
			yield* adapter.cancelTurn({ sessionId })
			yield* Queue.end(inbound)
		})
	)

	Vitest.it.effect("cancelTurn notifies session/cancel and emits TurnCancelled", () =>
		Effect.gen(function*() {
			const inbound = yield* Queue.unbounded<Json, Done>()
			const recorded = yield* Ref.make<ReadonlyArray<CopilotAcpRequest>>(Arr.empty())
			const promptDone = yield* Deferred.make<Json>()
			const cancels = yield* Ref.make(0)
			const adapter = yield* makeCopilotAdapter({
				presence: Effect.succeed(copilotPresence(true, true)),
				createTransport: () =>
					Effect.succeed(fakeHandle({ inbound, recorded, promptDone, cancels }))
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
			const cancelled = yield* takeUntil(events, (event) => event.type === "TurnCancelled")
			Vitest.assert.strictEqual(cancelled.type, "TurnCancelled")
			Vitest.assert.strictEqual(yield* Ref.get(cancels), 1)
			const requests = yield* Ref.get(recorded)
			const cancel = Arr.findFirst(
				requests,
				(request) => request.method === "session/cancel"
			)
			Vitest.assert.isTrue(Option.isSome(cancel))
			if (Option.isSome(cancel)) {
				Vitest.assert.deepStrictEqual(cancel.value.params, {
					sessionId: "acp-copilot-1"
				})
			}
			yield* Queue.end(inbound)
		})
	)

	Vitest.it.effect("steers into the active turn instead of opening a second turn", () =>
		Effect.gen(function*() {
			const inbound = yield* Queue.unbounded<Json, Done>()
			const recorded = yield* Ref.make<ReadonlyArray<CopilotAcpRequest>>(Arr.empty())
			const promptDone = yield* Deferred.make<Json>()
			const cancels = yield* Ref.make(0)
			const adapter = yield* makeCopilotAdapter({
				presence: Effect.succeed(copilotPresence(true, true)),
				createTransport: () =>
					Effect.succeed(fakeHandle({ inbound, recorded, promptDone, cancels }))
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
					text: "First"
				})
			)
			yield* Stream.runCollect(
				adapter.sendPrompt({
					sessionId,
					messageId: steerMessageId,
					text: "Steer"
				})
			)
			const prompts = Arr.filter(
				yield* Ref.get(recorded),
				(request) => request.method === "session/prompt"
			)
			Vitest.assert.strictEqual(prompts.length, 2)
			yield* Deferred.succeed(promptDone, { stopReason: "end_turn" })
			const completed = yield* takeUntil(events, (event) => {
				if (event.type !== "SessionMetaUpdated") {
					return false
				}
				const fact = decodeContractFact(event.metadata)
				return Option.isSome(fact) && fact.value.contractKind === "turn_complete"
			})
			Vitest.assert.strictEqual(completed.type, "SessionMetaUpdated")
			yield* adapter.cancelTurn({ sessionId })
			yield* Queue.end(inbound)
		})
	)
})
