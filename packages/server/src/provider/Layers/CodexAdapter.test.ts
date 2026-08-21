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
	type CodexAdapter,
	type CodexAppServerHandle,
	type CodexJsonRpcRequest
} from "./CodexAdapter.ts"
import { decodeContractFact } from "./CodexNativeMap.ts"
import {
	CODEX_APP_SERVER_ARGS,
	CODEX_PLACEHOLDER_COMMAND,
	CODEX_PROVIDER_ID,
	codexPresence,
	defaultCodexNativeConfigState
} from "./CodexProvider.ts"

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
			yield* Queue.offer(inbound, {
				method: "turn/completed",
				params: {
					turn: { id: "turn-1", status: "completed" }
				}
			})
			const complete = yield* Queue.take(events)
			Vitest.assert.strictEqual(complete.type, "SessionMetaUpdated")
			const completeFact = decodeContractFact(complete.metadata)
			if (Option.isSome(completeFact)) {
				Vitest.assert.strictEqual(completeFact.value.contractKind, "turn_complete")
			}
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

	Vitest.it.effect("replies to native permission requests", () =>
		Effect.gen(function*() {
			const inbound = yield* Queue.unbounded<Json, Done>()
			const requests = yield* Ref.make<ReadonlyArray<RecordedRequest>>(Arr.empty())
			const replies = yield* Ref.make<ReadonlyArray<Json>>(Arr.empty())
			const adapter = yield* makeTestAdapter(inbound, requests, replies)
			const { events } = yield* openSession(adapter)
			yield* Queue.offer(inbound, {
				jsonrpc: "2.0",
				id: 42,
				method: "item/fileRead/requestApproval",
				params: {
					itemId: "tool-1",
					path: "src/lib.rs"
				}
			})
			const permissionEvent = yield* Queue.take(events)
			Vitest.assert.strictEqual(permissionEvent.type, "SessionMetaUpdated")
			const fact = decodeContractFact(permissionEvent.metadata)
			if (Option.isSome(fact) && fact.value.contractKind === "permission_request") {
				Vitest.assert.strictEqual(fact.value.id, "42")
				Vitest.assert.strictEqual(fact.value.permission, "Read src/lib.rs")
			}
			yield* adapter.respondToPermission({
				sessionId,
				permissionId: "42",
				decision: "once"
			})
			const recordedReplies = yield* Ref.get(replies)
			Vitest.assert.deepStrictEqual(recordedReplies[0], {
				id: 42,
				result: { decision: "accept" }
			})
			yield* Queue.end(inbound)
		})
	)

	Vitest.it.effect("replies to native question requests with original question ids", () =>
		Effect.gen(function*() {
			const inbound = yield* Queue.unbounded<Json, Done>()
			const requests = yield* Ref.make<ReadonlyArray<RecordedRequest>>(Arr.empty())
			const replies = yield* Ref.make<ReadonlyArray<Json>>(Arr.empty())
			const adapter = yield* makeTestAdapter(inbound, requests, replies)
			const { events } = yield* openSession(adapter)
			yield* Queue.offer(inbound, {
				jsonrpc: "2.0",
				id: 7,
				method: "item/tool/requestUserInput",
				params: {
					itemId: "tool-question-1",
					questions: [
						{
							id: "scope",
							header: "Scope",
							question: "Apply to?",
							multiSelect: true,
							options: [
								{ label: "File", description: "This file only" },
								{ label: "Project", description: "Whole project" }
							]
						}
					]
				}
			})
			const questionEvent = yield* Queue.take(events)
			const fact = decodeContractFact(questionEvent.metadata)
			if (Option.isSome(fact) && fact.value.contractKind === "question_request") {
				Vitest.assert.strictEqual(fact.value.id, "7")
			}
			yield* adapter.respondToQuestion({
				sessionId,
				requestId: "7",
				answers: [["Project"]]
			})
			const recordedReplies = yield* Ref.get(replies)
			Vitest.assert.deepStrictEqual(recordedReplies[0], {
				id: 7,
				result: {
					answers: {
						scope: { answers: ["Project"] }
					}
				}
			})
			yield* Queue.end(inbound)
		})
	)

	Vitest.it("exposes the Codex provider id", () => {
		Vitest.assert.strictEqual(CODEX_PROVIDER_ID, "codex")
	})
})
