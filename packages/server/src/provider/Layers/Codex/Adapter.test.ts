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
import * as Effect from "effect/Effect"
import * as Option from "effect/Option"
import * as Queue from "effect/Queue"
import * as Ref from "effect/Ref"
import * as Schema from "effect/Schema"
import * as Stream from "effect/Stream"
import {
	makeCodexAdapter,
	type CodexAdapter
} from "./Adapter.ts"
import { decodeContractFact } from "./Codec.ts"
import type { CodexAppServerHandle, CodexJsonRpcRequest } from "./Process.ts"
import {
	CODEX_APP_SERVER_ARGS,
	CODEX_PLACEHOLDER_COMMAND,
	CODEX_PROVIDER_ID,
	codexPresence,
	defaultCodexNativeConfigState
} from "./Provider.ts"

type Json = typeof Schema.Json.Type

const sessionId = SessionId.make("session-1")
const projectId = ProjectId.make("project-1")
const messageId = MessageId.make("message-user")

type RecordedRequest = {
	readonly method: string
	readonly params: Json
}

const scriptedResult = (method: string): Json => {
	if (method === "initialize") {
		return {}
	}
	if (method === "thread/start") {
		return {
			thread: { id: "thread-1" }
		}
	}
	if (method === "turn/start") {
		return {
			turn: { id: "turn-1" }
		}
	}
	if (method === "turn/interrupt") {
		return {}
	}
	return {}
}

const fakeHandle = (
	inbound: Queue.Queue<Json, Done>,
	requests: Ref.Ref<ReadonlyArray<RecordedRequest>>,
	replies: Ref.Ref<ReadonlyArray<Json>>
): CodexAppServerHandle => ({
	notifications: Stream.fromQueue(inbound),
	request: (input: CodexJsonRpcRequest) =>
		Ref.update(requests, (current) =>
			Arr.append(current, { method: input.method, params: input.params })
		).pipe(Effect.as(scriptedResult(input.method))),
	notify: (method, params) =>
		Ref.update(requests, (current) =>
			Arr.append(current, {
				method,
				params: Option.getOrElse(params, () => null)
			})
		).pipe(Effect.asVoid),
	reply: (id, result) =>
		Ref.update(replies, (current) => Arr.append(current, { id, result })).pipe(Effect.asVoid),
	close: Queue.end(inbound).pipe(Effect.asVoid)
})

const makeTestAdapter = Effect.fn("makeTestAdapter")(function*(
	inbound: Queue.Queue<Json, Done>,
	requests: Ref.Ref<ReadonlyArray<RecordedRequest>>,
	replies: Ref.Ref<ReadonlyArray<Json>>
) {
	return yield* makeCodexAdapter({
		presence: Effect.succeed(codexPresence(true, true)),
		spawn: {
			command: CODEX_PLACEHOLDER_COMMAND,
			args: Arr.fromIterable(CODEX_APP_SERVER_ARGS)
		},
		config: defaultCodexNativeConfigState(),
		createAppServer: () => Effect.succeed(fakeHandle(inbound, requests, replies))
	})
})

const openSession = Effect.fn("openSession")(function*(adapter: CodexAdapter) {
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
	return { events, opened }
})

Vitest.describe("CodexAdapter", () => {
	Vitest.it.effect("opens a native thread then emits provider_session", () =>
		Effect.gen(function*() {
			const inbound = yield* Queue.unbounded<Json, Done>()
			const requests = yield* Ref.make<ReadonlyArray<RecordedRequest>>(Arr.empty())
			const replies = yield* Ref.make<ReadonlyArray<Json>>(Arr.empty())
			const adapter = yield* makeTestAdapter(inbound, requests, replies)
			const { opened } = yield* openSession(adapter)
			Vitest.assert.strictEqual(opened.type, "SessionMetaUpdated")
			const fact = decodeContractFact(opened.metadata)
			Vitest.assert.isTrue(Option.isSome(fact))
			if (Option.isSome(fact)) {
				Vitest.assert.strictEqual(fact.value.contractKind, "provider_session")
				if (fact.value.contractKind === "provider_session") {
					Vitest.assert.strictEqual(fact.value.providerSessionId, "thread-1")
				}
			}
			const recorded = yield* Ref.get(requests)
			Vitest.assert.strictEqual(recorded[0]?.method, "initialize")
			Vitest.assert.strictEqual(recorded[1]?.method, "initialized")
			Vitest.assert.strictEqual(recorded[2]?.method, "thread/start")
			Vitest.assert.deepStrictEqual(recorded[2]?.params, {
				cwd: "/tmp/acepe",
				experimentalRawEvents: false,
				persistExtendedHistory: true
			})
			yield* Queue.end(inbound)
		})
	)

	Vitest.it.effect("sends turn/start and streams TokenAppended from app-server deltas", () =>
		Effect.gen(function*() {
			const inbound = yield* Queue.unbounded<Json, Done>()
			const requests = yield* Ref.make<ReadonlyArray<RecordedRequest>>(Arr.empty())
			const replies = yield* Ref.make<ReadonlyArray<Json>>(Arr.empty())
			const adapter = yield* makeTestAdapter(inbound, requests, replies)
			const { events } = yield* openSession(adapter)
			const sent = yield* Stream.runCollect(
				adapter.sendPrompt({
					sessionId,
					messageId,
					text: "Hi"
				})
			)
			Vitest.assert.strictEqual(sent[0]?.type, "MessageSent")
			const recorded = yield* Ref.get(requests)
			const turnStart = Arr.findFirst(recorded, (entry) => entry.method === "turn/start")
			Vitest.assert.isTrue(Option.isSome(turnStart))
			if (Option.isSome(turnStart) && Schema.is(Schema.JsonObject)(turnStart.value.params)) {
				Vitest.assert.strictEqual(turnStart.value.params.threadId, "thread-1")
				Vitest.assert.strictEqual(turnStart.value.params.effort, "high")
			}
			yield* Queue.offer(inbound, {
				method: "item/agentMessage/delta",
				params: {
					itemId: "msg-1",
					delta: "Hello"
				}
			})
			const tokenEvent = yield* Queue.take(events)
			Vitest.assert.strictEqual(tokenEvent.type, "TokenAppended")
			if (tokenEvent.type === "TokenAppended") {
				Vitest.assert.strictEqual(tokenEvent.payload.token, "Hello")
				Vitest.assert.strictEqual(
					tokenEvent.payload.messageId,
					tracerAssistantMessageId(messageId)
				)
			}
			// Reproduces the live bug: turn/completed used to fold into a generic
			// SessionMetaUpdated that nothing reacted to, so projection_turns never
			// closed the turn absent a follow-up message. It must now surface as
			// its own TurnCompleted contract event.
			yield* Queue.offer(inbound, {
				method: "turn/completed",
				params: {
					turn: { id: "turn-1", status: "completed" }
				}
			})
			const complete = yield* Queue.take(events)
			Vitest.assert.strictEqual(complete.type, "TurnCompleted")
			if (complete.type === "TurnCompleted") {
				Vitest.assert.strictEqual(complete.payload.sessionId, sessionId)
				Vitest.assert.strictEqual(complete.payload.turnId, "turn-1")
			}
			yield* Queue.end(inbound)
		})
	)

	// Reproduces the same live QA bug as ClaudeAdapter.test.ts's ToolCallObserved
	// test: a real Codex tool item (item/started then item/completed) executed,
	// but CodexNativeMap's tool_call/tool_call_update facts folded into a
	// generic SessionMetaUpdated that ProjectionSessionActivities.ts has no
	// case for.
	Vitest.it.effect(
		"emits ToolCallObserved (in_progress then completed) for a real Codex tool item",
		() =>
			Effect.gen(function*() {
				const inbound = yield* Queue.unbounded<Json, Done>()
				const requests = yield* Ref.make<ReadonlyArray<RecordedRequest>>(Arr.empty())
				const replies = yield* Ref.make<ReadonlyArray<Json>>(Arr.empty())
				const adapter = yield* makeTestAdapter(inbound, requests, replies)
				const { events } = yield* openSession(adapter)
				yield* Stream.runCollect(
					adapter.sendPrompt({ sessionId, messageId, text: "Read package.json" })
				)
				yield* Queue.offer(inbound, {
					method: "item/started",
					params: {
						item: {
							id: "item-read-1",
							type: "fileRead",
							filePath: "/tmp/acepe/package.json"
						}
					}
				})
				let started: OrchestrationEvent | undefined
				for (let attempt = 0; attempt < 5 && started === undefined; attempt++) {
					const next = yield* Queue.take(events)
					if (next.type === "SessionMetaUpdated") {
						const fact = decodeContractFact(next.metadata)
						if (Option.isSome(fact)) {
							Vitest.assert.notStrictEqual(fact.value.contractKind, "tool_call")
							Vitest.assert.notStrictEqual(fact.value.contractKind, "tool_call_update")
						}
					}
					if (next.type === "ToolCallObserved") {
						started = next
					}
				}
				if (started === undefined || started.type !== "ToolCallObserved") {
					Vitest.assert.fail("expected a ToolCallObserved event for item/started")
					return
				}
				Vitest.assert.strictEqual(started.payload.status, "in_progress")
				Vitest.assert.strictEqual(started.payload.title, "Read /tmp/acepe/package.json")
				Vitest.assert.strictEqual(started.payload.toolCallId, "item-read-1")
				Vitest.assert.strictEqual(started.payload.path, "/tmp/acepe/package.json")
				// #273: a started item has reported no result yet.
				Vitest.assert.strictEqual(started.payload.output, null)

				yield* Queue.offer(inbound, {
					method: "item/completed",
					params: {
						item: {
							id: "item-read-1",
							type: "fileRead",
							filePath: "/tmp/acepe/package.json",
							status: "completed",
							aggregatedOutput: "{ \"name\": \"acepe\" }"
						}
					}
				})
				let completed: OrchestrationEvent | undefined
				for (let attempt = 0; attempt < 5 && completed === undefined; attempt++) {
					const next = yield* Queue.take(events)
					if (next.type === "ToolCallObserved") {
						completed = next
					}
				}
				if (completed === undefined || completed.type !== "ToolCallObserved") {
					Vitest.assert.fail("expected a ToolCallObserved event for item/completed")
					return
				}
				Vitest.assert.strictEqual(completed.payload.status, "completed")
				Vitest.assert.strictEqual(completed.payload.activityId, started.payload.activityId)
				// #273: Codex's own tool result (Map.ts's toolResult reads
				// aggregatedOutput, else exitCode) reaches the canonical
				// payload instead of stopping at the fact.
				Vitest.assert.strictEqual(completed.payload.output, "{ \"name\": \"acepe\" }")
				yield* Queue.end(inbound)
			})
	)

	// AC-269: same swallow pattern the ToolCallObserved test above already
	// fixed for tool calls -- a real thread/tokenUsage/updated notification
	// used to fold into a generic SessionMetaUpdated event nothing downstream
	// reads for usage. Pins down that CodexAdapter now publishes a typed
	// TurnUsageObserved event carrying the open turn's id instead.
	Vitest.it.effect(
		"emits TurnUsageObserved for a real thread/tokenUsage/updated notification, not SessionMetaUpdated",
		() =>
			Effect.gen(function*() {
				const inbound = yield* Queue.unbounded<Json, Done>()
				const requests = yield* Ref.make<ReadonlyArray<RecordedRequest>>(Arr.empty())
				const replies = yield* Ref.make<ReadonlyArray<Json>>(Arr.empty())
				const adapter = yield* makeTestAdapter(inbound, requests, replies)
				const { events } = yield* openSession(adapter)
				yield* Stream.runCollect(
					adapter.sendPrompt({
						sessionId,
						messageId,
						text: "Hi"
					})
				)
				yield* Queue.offer(inbound, {
					method: "thread/tokenUsage/updated",
					params: {
						threadId: "thread-1",
						turnId: "turn-1",
						tokenUsage: {
							input_tokens: 120,
							output_tokens: 48,
							total_tokens: 168,
							model_context_window: 200_000
						}
					}
				})
				let observed: OrchestrationEvent | undefined
				for (let attempt = 0; attempt < 5 && observed === undefined; attempt++) {
					const next = yield* Queue.take(events)
					if (next.type === "SessionMetaUpdated") {
						const fact = decodeContractFact(next.metadata)
						if (Option.isSome(fact)) {
							Vitest.assert.notStrictEqual(fact.value.contractKind, "usage")
						}
					}
					if (next.type === "TurnUsageObserved") {
						observed = next
					}
				}
				if (observed === undefined || observed.type !== "TurnUsageObserved") {
					Vitest.assert.fail("expected a TurnUsageObserved event for the token usage notification")
					return
				}
				Vitest.assert.strictEqual(observed.payload.sessionId, sessionId)
				Vitest.assert.strictEqual(observed.payload.turnId, "turn-1")
				Vitest.assert.strictEqual(observed.payload.inputTokens, 120)
				Vitest.assert.strictEqual(observed.payload.outputTokens, 48)
				Vitest.assert.strictEqual(observed.payload.totalTokens, 168)
				Vitest.assert.strictEqual(observed.payload.contextWindowSize, 200_000)
				yield* Queue.end(inbound)
			})
	)

	Vitest.it.effect("cancelTurn sends turn/interrupt and keeps the app-server open", () =>
		Effect.gen(function*() {
			const inbound = yield* Queue.unbounded<Json, Done>()
			const requests = yield* Ref.make<ReadonlyArray<RecordedRequest>>(Arr.empty())
			const replies = yield* Ref.make<ReadonlyArray<Json>>(Arr.empty())
			const adapter = yield* makeTestAdapter(inbound, requests, replies)
			const { events } = yield* openSession(adapter)
			yield* Stream.runCollect(
				adapter.sendPrompt({
					sessionId,
					messageId,
					text: "Hi"
				})
			)
			yield* adapter.cancelTurn({ sessionId })
			const cancelled = yield* Queue.take(events)
			Vitest.assert.strictEqual(cancelled.type, "TurnCancelled")
			const recorded = yield* Ref.get(requests)
			const interrupt = Arr.findFirst(recorded, (entry) => entry.method === "turn/interrupt")
			Vitest.assert.isTrue(Option.isSome(interrupt))
			if (Option.isSome(interrupt)) {
				Vitest.assert.deepStrictEqual(interrupt.value.params, {
					threadId: "thread-1",
					turnId: "turn-1"
				})
			}
			yield* Queue.offer(inbound, {
				method: "item/agentMessage/delta",
				params: {
					itemId: "msg-1",
					delta: "still live"
				}
			})
			const tokenEvent = yield* Queue.take(events)
			Vitest.assert.strictEqual(tokenEvent.type, "TokenAppended")
			yield* Queue.end(inbound)
		})
	)

	Vitest.it("exposes the Codex provider id", () => {
		Vitest.assert.strictEqual(CODEX_PROVIDER_ID, "codex")
	})
})
