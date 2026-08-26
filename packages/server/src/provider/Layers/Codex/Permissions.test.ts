import {
	type ApprovalRequestedEvent,
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
import * as Schema from "effect/Schema"
import * as Stream from "effect/Stream"
import {
	makeCodexAdapter,
	type CodexAdapter
} from "./Adapter.ts"
import { decodeContractFact } from "./Codec.ts"
import { mapCodexPermissionReply } from "./Permissions.ts"
import type { CodexAppServerHandle, CodexJsonRpcRequest } from "./Process.ts"
import {
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

// Fails loudly if a permission request folds into the generic
// SessionMetaUpdated branch instead of the typed approval event.
const nextApprovalRequested = Effect.fn("nextApprovalRequested")(function*(
	events: Queue.Queue<OrchestrationEvent, Done>
) {
	let found: ApprovalRequestedEvent | undefined
	for (let attempt = 0; attempt < 5 && found === undefined; attempt++) {
		const next = yield* Queue.take(events)
		if (next.type === "SessionMetaUpdated") {
			const fact = decodeContractFact(next.metadata)
			if (Option.isSome(fact)) {
				Vitest.assert.notStrictEqual(fact.value.contractKind, "permission_request")
			}
		}
		if (next.type === "ApprovalRequested") {
			found = next
		}
	}
	return found
})

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
			if (requested === undefined) {
				Vitest.assert.fail("expected an ApprovalRequested event for the approval request")
				return
			}
			Vitest.assert.strictEqual(requested.payload.approvalRequestId, "42")
			Vitest.assert.strictEqual(requested.payload.title, "Read src/lib.rs")
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

	// JSON-RPC 2.0 allows a string id, and the reply has to carry back the same
	// JSON value. PermissionRequestFact narrows the id to a string, so a number
	// and a string both reach respondToPermission as text.
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
			if (requested === undefined) {
				Vitest.assert.fail("expected an ApprovalRequested event for the approval request")
				return
			}
			Vitest.assert.strictEqual(requested.payload.approvalRequestId, "req-42")
			yield* adapter.respondToPermission({
				sessionId,
				permissionId: "req-42",
				decision: "always"
			})
			const recordedReplies = yield* Ref.get(replies)
			Vitest.assert.deepStrictEqual(recordedReplies[0], {
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
			const fact = decodeContractFact(questionEvent.metadata)
			if (Option.isSome(fact) && fact.value.contractKind === "question_request") {
				Vitest.assert.strictEqual(fact.value.id, "req-question-7")
			}
			yield* adapter.respondToQuestion({
				sessionId,
				requestId: "req-question-7",
				answers: [["File"]]
			})
			const recordedReplies = yield* Ref.get(replies)
			Vitest.assert.deepStrictEqual(recordedReplies[0], {
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
			if (requested === undefined) {
				Vitest.assert.fail("expected an ApprovalRequested event for the approval request")
				return
			}
			Vitest.assert.strictEqual(requested.payload.sessionId, sessionId)
			Vitest.assert.strictEqual(requested.payload.approvalRequestId, "99")
			Vitest.assert.strictEqual(requested.payload.title, "rm -rf build")
			yield* Queue.end(inbound)
		})
	)
})
