import {
	type OrchestrationEvent,
	ProjectId,
	SessionId
} from "@acepe/contracts"
import * as Vitest from "@effect/vitest"
import type { Done } from "effect/Cause"
import * as Arr from "effect/Array"
import * as Effect from "effect/Effect"
import * as Option from "effect/Option"
import * as Queue from "effect/Queue"
import * as Ref from "effect/Ref"
import * as Result from "effect/Result"
import * as Schema from "effect/Schema"
import * as Stream from "effect/Stream"
import {
	makeCodexAdapter,
	type CodexAdapter
} from "./Adapter.ts"
import { decodeContractFact } from "./Codec.ts"
import { mapCodexPermissionReply } from "./Permissions.ts"
import type { CodexAppServerHandle, CodexJsonRpcReply, CodexJsonRpcRequest } from "./Process.ts"
import {
	adapterError,
	CODEX_APP_SERVER_ARGS,
	CODEX_PLACEHOLDER_COMMAND,
	codexPresence,
	defaultCodexNativeConfigState
} from "./Provider.ts"

type Json = typeof Schema.Json.Type

const sessionId = SessionId.make("session-1")
const projectId = ProjectId.make("project-1")

type RecordedRequest = {
	readonly method: string
	readonly params: Json
}

const scriptedResult = (method: string): Json => {
	if (method === "thread/start") {
		return {
			thread: { id: "thread-1" }
		}
	}
	return {}
}

// Every reply assertion below pins the operation as well as the body: the
// reply path used to hand the transport the literal "sendPrompt" no matter
// which answer the operator had given.
const recordReply = (input: CodexJsonRpcReply): Json => ({
	operation: input.operation,
	id: input.id,
	result: input.result
})

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
	reply: (input) =>
		Ref.update(replies, (current) => Arr.append(current, recordReply(input))).pipe(
			Effect.asVoid
		),
	close: Queue.end(inbound).pipe(Effect.asVoid)
})

// Same handle, except the first `reply` attempt is rejected by the
// transport — what a retry after a lazy session open runs into.
const rejectingFirstReplyHandle = (
	inbound: Queue.Queue<Json, Done>,
	requests: Ref.Ref<ReadonlyArray<RecordedRequest>>,
	replies: Ref.Ref<ReadonlyArray<Json>>,
	rejections: Ref.Ref<number>
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
	reply: (input) =>
		Ref.modify(rejections, (remaining) =>
			[remaining, remaining > 0 ? remaining - 1 : 0] as const
		).pipe(
			Effect.flatMap((remaining) =>
				remaining > 0
					? adapterError("respondToPermission", "Codex app-server write failed")
					: Ref.update(replies, (current) =>
						Arr.append(current, recordReply(input))
					).pipe(Effect.asVoid)
			)
		),
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
			workspaceRoot: "/tmp/acepe",
			envOverrides: {}
		})
		.pipe(
			Stream.runForEach((event) => Queue.offer(events, event).pipe(Effect.asVoid)),
			Effect.forkChild({ startImmediately: true })
		)
	const opened = yield* Queue.take(events)
	return { events, opened }
})

// Fails loudly if a permission request folds into the generic
// SessionMetaUpdated branch instead of the typed approval event, and fails
// loudly here — rather than handing back nothing for every call site to
// re-check — when no approval event arrives at all.
const nextApprovalRequested = Effect.fn("nextApprovalRequested")(function*(
	events: Queue.Queue<OrchestrationEvent, Done>
) {
	for (let attempt = 0; attempt < 5; attempt++) {
		const next = yield* Queue.take(events)
		if (next.type === "SessionMetaUpdated") {
			const fact = decodeContractFact(next.metadata)
			if (Option.isSome(fact)) {
				Vitest.assert.notStrictEqual(fact.value.contractKind, "permission_request")
			}
		}
		if (next.type === "ApprovalRequested") {
			return next
		}
	}
	return Vitest.assert.fail(
		"expected an ApprovalRequested event within the first 5 events of the approval request"
	)
})

// Asserts the event's metadata decodes to a question_request fact and hands
// the narrowed fact back. The tests below used to wrap their id assertion in
// `if (Option.isSome(fact) && fact.value.contractKind === "question_request")`,
// which reports green when the decode fails or the kind changes — the two
// regressions that id assertion exists to catch.
const questionRequestFact = (event: OrchestrationEvent) => {
	const fact = decodeContractFact(event.metadata)
	Vitest.assert.isTrue(
		Option.isSome(fact),
		"the question event's metadata must decode to a contract fact"
	)
	const value = Option.getOrElse(fact, () =>
		Vitest.assert.fail("the question event's metadata must decode to a contract fact")
	)
	Vitest.assert.strictEqual(value.contractKind, "question_request")
	return value.contractKind === "question_request"
		? value
		: Vitest.assert.fail("the question event must carry a question_request fact")
}

Vitest.describe("CodexAdapter permissions", () => {
	Vitest.it("maps permission replies onto Codex decisions", () => {
		Vitest.assert.deepStrictEqual(mapCodexPermissionReply("once"), Option.some("accept"))
		Vitest.assert.deepStrictEqual(
			mapCodexPermissionReply("always"),
			Option.some("acceptForSession")
		)
		Vitest.assert.deepStrictEqual(mapCodexPermissionReply("reject"), Option.some("decline"))
		Vitest.assert.deepStrictEqual(mapCodexPermissionReply("allow"), Option.some("accept"))
		Vitest.assert.strictEqual(Option.isNone(mapCodexPermissionReply("maybe")), true)
	})

	// A reply that fails is not a prompt that failed. Labelling both
	// "sendPrompt" sent the operator hunting through the prompt path for a
	// fault that lives in the permission/question reply path.
	Vitest.it.effect("names the reply operation that actually failed", () =>
		Effect.gen(function*() {
			const inbound = yield* Queue.unbounded<Json, Done>()
			const requests = yield* Ref.make<ReadonlyArray<RecordedRequest>>(Arr.empty())
			const replies = yield* Ref.make<ReadonlyArray<Json>>(Arr.empty())
			const adapter = yield* makeTestAdapter(inbound, requests, replies)
			yield* openSession(adapter)
			const permission = yield* adapter
				.respondToPermission({
					sessionId,
					permissionId: "42",
					decision: "maybe"
				})
				.pipe(Effect.flip)
			Vitest.assert.strictEqual(permission._tag, "ProviderAdapterError")
			Vitest.assert.strictEqual(permission.operation, "respondToPermission")
			const question = yield* adapter
				.respondToQuestion({
					sessionId,
					requestId: "unknown-question",
					answers: [["File"]]
				})
				.pipe(Effect.flip)
			Vitest.assert.strictEqual(question._tag, "ProviderAdapterError")
			Vitest.assert.strictEqual(question.operation, "respondToQuestion")
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
			const requested = yield* nextApprovalRequested(events)
			Vitest.assert.strictEqual(requested.payload.approvalRequestId, "42")
			Vitest.assert.strictEqual(requested.payload.title, "Read src/lib.rs")
			yield* adapter.respondToPermission({
				sessionId,
				permissionId: "42",
				decision: "once"
			})
			const recordedReplies = yield* Ref.get(replies)
			Vitest.assert.deepStrictEqual(recordedReplies[0], {
				operation: "respondToPermission",
				id: 42,
				result: { decision: "accept" }
			})
			yield* Queue.end(inbound)
		})
	)

	// JSON-RPC 2.0 allows a string id, and the reply has to carry back the same
	// JSON value. PermissionRequestFact narrows the id to a string, so a number
	// and a string both reach respondToPermission as text.
	// Codex requires the response id to repeat the request id in its original
	// JSON type. takeReplyId used to fall back to the fact's text id when the
	// map held no entry, so a second reply answered a numeric request with a
	// string — a protocol violation Codex cannot report, so the request just
	// hangs. A loud typed error is the only honest answer.
	Vitest.it.effect("refuses a second reply to a permission request it already answered", () =>
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
			yield* nextApprovalRequested(events)
			yield* adapter.respondToPermission({
				sessionId,
				permissionId: "42",
				decision: "once"
			})
			const second = yield* Effect.result(
				adapter.respondToPermission({
					sessionId,
					permissionId: "42",
					decision: "once"
				})
			)
			if (Result.isSuccess(second)) {
				Vitest.assert.fail("a second reply to an answered permission must fail loudly")
				return
			}
			Vitest.assert.strictEqual(second.failure._tag, "ProviderAdapterError")
			Vitest.assert.strictEqual(second.failure.operation, "respondToPermission")
			// One reply, carrying the number Codex asked with — never a
			// second one carrying the string "42".
			Vitest.assert.deepStrictEqual(yield* Ref.get(replies), [
				{ operation: "respondToPermission", id: 42, result: { decision: "accept" } }
			])
			yield* Queue.end(inbound)
		})
	)

	// The claim only really disappears once the reply lands. ProviderBridge
	// retries respondToPermission after a lazy session open (see
	// LAZY_OPEN_RETRY_SCHEDULE), and a claim burned by the failed attempt
	// would leave the retry with nothing to answer with — the same silent
	// hang, reached from the other side.
	Vitest.it.effect("keeps the reply id when the transport rejects the first attempt", () =>
		Effect.gen(function*() {
			const inbound = yield* Queue.unbounded<Json, Done>()
			const requests = yield* Ref.make<ReadonlyArray<RecordedRequest>>(Arr.empty())
			const replies = yield* Ref.make<ReadonlyArray<Json>>(Arr.empty())
			const rejections = yield* Ref.make(1)
			const adapter = yield* makeCodexAdapter({
				presence: Effect.succeed(codexPresence(true, true)),
				spawn: {
					command: CODEX_PLACEHOLDER_COMMAND,
					args: Arr.fromIterable(CODEX_APP_SERVER_ARGS)
				},
				config: defaultCodexNativeConfigState(),
				createAppServer: () =>
					Effect.succeed(rejectingFirstReplyHandle(inbound, requests, replies, rejections))
			})
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
			yield* nextApprovalRequested(events)
			const rejected = yield* Effect.result(
				adapter.respondToPermission({
					sessionId,
					permissionId: "42",
					decision: "once"
				})
			)
			Vitest.assert.isTrue(Result.isFailure(rejected))
			yield* adapter.respondToPermission({
				sessionId,
				permissionId: "42",
				decision: "once"
			})
			Vitest.assert.deepStrictEqual(yield* Ref.get(replies), [
				{ operation: "respondToPermission", id: 42, result: { decision: "accept" } }
			])
			yield* Queue.end(inbound)
		})
	)

	// A question can arrive as a NOTIFICATION, with no JSON-RPC id at all:
	// Map.ts falls the fact's id back to the item id, so questionIds learns
	// about it while replyIds cannot. respondToQuestion used to sail past
	// that and reply with the item id as the request id, answering a request
	// that never existed.
	Vitest.it.effect("refuses to answer a question that arrived with no request id", () =>
		Effect.gen(function*() {
			const inbound = yield* Queue.unbounded<Json, Done>()
			const requests = yield* Ref.make<ReadonlyArray<RecordedRequest>>(Arr.empty())
			const replies = yield* Ref.make<ReadonlyArray<Json>>(Arr.empty())
			const adapter = yield* makeTestAdapter(inbound, requests, replies)
			const { events } = yield* openSession(adapter)
			yield* Queue.offer(inbound, {
				jsonrpc: "2.0",
				method: "item/tool/requestUserInput",
				params: {
					itemId: "tool-question-3",
					questions: [
						{
							id: "scope",
							header: "Scope",
							question: "Apply to?",
							multiSelect: false,
							options: [
								{ label: "File", description: "This file only" },
								{ label: "Project", description: "Whole project" }
							]
						}
					]
				}
			})
			const questionEvent = yield* Queue.take(events)
			Vitest.assert.strictEqual(questionRequestFact(questionEvent).id, "tool-question-3")
			const answered = yield* Effect.result(
				adapter.respondToQuestion({
					sessionId,
					requestId: "tool-question-3",
					answers: [["File"]]
				})
			)
			if (Result.isSuccess(answered)) {
				Vitest.assert.fail("answering a question Codex never asked as a request must fail")
				return
			}
			Vitest.assert.strictEqual(answered.failure._tag, "ProviderAdapterError")
			Vitest.assert.strictEqual(answered.failure.operation, "respondToQuestion")
			Vitest.assert.deepStrictEqual(yield* Ref.get(replies), [])
			yield* Queue.end(inbound)
		})
	)

	Vitest.it.effect("replies to a string-id permission request with that same string id", () =>
		Effect.gen(function*() {
			const inbound = yield* Queue.unbounded<Json, Done>()
			const requests = yield* Ref.make<ReadonlyArray<RecordedRequest>>(Arr.empty())
			const replies = yield* Ref.make<ReadonlyArray<Json>>(Arr.empty())
			const adapter = yield* makeTestAdapter(inbound, requests, replies)
			const { events } = yield* openSession(adapter)
			yield* Queue.offer(inbound, {
				jsonrpc: "2.0",
				id: "req-42",
				method: "item/commandExecution/requestApproval",
				params: {
					itemId: "tool-2",
					command: "ls -la"
				}
			})
			const requested = yield* nextApprovalRequested(events)
			Vitest.assert.strictEqual(requested.payload.approvalRequestId, "req-42")
			yield* adapter.respondToPermission({
				sessionId,
				permissionId: "req-42",
				decision: "always"
			})
			const recordedReplies = yield* Ref.get(replies)
			Vitest.assert.deepStrictEqual(recordedReplies[0], {
				operation: "respondToPermission",
				id: "req-42",
				result: { decision: "acceptForSession" }
			})
			yield* Queue.end(inbound)
		})
	)

	Vitest.it.effect("replies to a string-id question request with that same string id", () =>
		Effect.gen(function*() {
			const inbound = yield* Queue.unbounded<Json, Done>()
			const requests = yield* Ref.make<ReadonlyArray<RecordedRequest>>(Arr.empty())
			const replies = yield* Ref.make<ReadonlyArray<Json>>(Arr.empty())
			const adapter = yield* makeTestAdapter(inbound, requests, replies)
			const { events } = yield* openSession(adapter)
			yield* Queue.offer(inbound, {
				jsonrpc: "2.0",
				id: "req-question-7",
				method: "item/tool/requestUserInput",
				params: {
					itemId: "tool-question-2",
					questions: [
						{
							id: "scope",
							header: "Scope",
							question: "Apply to?",
							multiSelect: false,
							options: [
								{ label: "File", description: "This file only" },
								{ label: "Project", description: "Whole project" }
							]
						}
					]
				}
			})
			const questionEvent = yield* Queue.take(events)
			Vitest.assert.strictEqual(questionRequestFact(questionEvent).id, "req-question-7")
			yield* adapter.respondToQuestion({
				sessionId,
				requestId: "req-question-7",
				answers: [["File"]]
			})
			const recordedReplies = yield* Ref.get(replies)
			Vitest.assert.deepStrictEqual(recordedReplies[0], {
				operation: "respondToQuestion",
				id: "req-question-7",
				result: {
					answers: {
						scope: { answers: ["File"] }
					}
				}
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
			Vitest.assert.strictEqual(questionRequestFact(questionEvent).id, "7")
			yield* adapter.respondToQuestion({
				sessionId,
				requestId: "7",
				answers: [["Project"]]
			})
			const recordedReplies = yield* Ref.get(replies)
			Vitest.assert.deepStrictEqual(recordedReplies[0], {
				operation: "respondToQuestion",
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

	// A native requestApproval used to fold into the generic makeMetaEvent /
	// SessionMetaUpdated branch, whose metadata nobody reads for approvals:
	// ProjectionPendingApprovals.apply only reacts to a native
	// ApprovalRequested/InteractionReplied event or an explicitly stamped
	// pendingApproval metadata key. respondToPermission already worked, so
	// Codex could answer a permission the desktop had no way to learn about:
	// projection_pending_approvals stayed empty and the turn hung on an
	// approval nobody could see. Same carve-out Claude and Cursor took.
	Vitest.it.effect("emits a typed ApprovalRequested carrying the permission title", () =>
		Effect.gen(function*() {
			const inbound = yield* Queue.unbounded<Json, Done>()
			const requests = yield* Ref.make<ReadonlyArray<RecordedRequest>>(Arr.empty())
			const replies = yield* Ref.make<ReadonlyArray<Json>>(Arr.empty())
			const adapter = yield* makeTestAdapter(inbound, requests, replies)
			const { events } = yield* openSession(adapter)
			yield* Queue.offer(inbound, {
				jsonrpc: "2.0",
				id: 99,
				method: "item/commandExecution/requestApproval",
				params: {
					itemId: "tool-99",
					command: "rm -rf build"
				}
			})
			const requested = yield* nextApprovalRequested(events)
			Vitest.assert.strictEqual(requested.payload.sessionId, sessionId)
			Vitest.assert.strictEqual(requested.payload.approvalRequestId, "99")
			Vitest.assert.strictEqual(requested.payload.title, "rm -rf build")
			yield* Queue.end(inbound)
		})
	)
})
