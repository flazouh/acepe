import {
	type ApprovalRequestedEvent,
	type OrchestrationEvent,
	type ToolCallObservedEvent,
	type TurnCompletedEvent,
	type TurnUsageObservedEvent,
	MessageId,
	PENDING_APPROVAL_METADATA_KEY,
	PendingApprovalFact,
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
import { decodeContractFact } from "./Codec.ts"
import {
	makeCopilotAdapter,
	type CopilotAcpHandle,
	type CopilotAcpRequest
} from "./Adapter.ts"
import { copilotPresence } from "./Provider.ts"

type Json = typeof Schema.Json.Type

const decodePendingApprovalFact = Schema.decodeUnknownOption(PendingApprovalFact)

const sessionId = SessionId.make("session-1")
const projectId = ProjectId.make("project-1")
const messageId = MessageId.make("message-user")
const steerMessageId = MessageId.make("message-steer")

type RecordedReply = {
	readonly id: Json
	readonly result: Json
}

const fakeHandle = (input: {
	readonly inbound: Queue.Queue<Json, Done>
	readonly recorded: Ref.Ref<ReadonlyArray<CopilotAcpRequest>>
	readonly replies: Ref.Ref<ReadonlyArray<RecordedReply>>
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
	reply: (id, result) =>
		Ref.update(input.replies, (current) => Arr.append(current, { id, result })).pipe(
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

// One open Copilot session over a scripted ACP handle, with the
// provider_session event already taken — where every test below begins.
const startTestSession = Effect.fn("startTestSession")(function*() {
	const inbound = yield* Queue.unbounded<Json, Done>()
	const recorded = yield* Ref.make<ReadonlyArray<CopilotAcpRequest>>(Arr.empty())
	const replies = yield* Ref.make<ReadonlyArray<RecordedReply>>(Arr.empty())
	const promptDone = yield* Deferred.make<Json>()
	const cancels = yield* Ref.make(0)
	const adapter = yield* makeCopilotAdapter({
		presence: Effect.succeed(copilotPresence(true, true)),
		createTransport: () =>
			Effect.succeed(fakeHandle({ inbound, recorded, replies, promptDone, cancels }))
	})
	const events = yield* Queue.unbounded<OrchestrationEvent, Done>()
	yield* adapter
		.startSession({ sessionId, projectId, workspaceRoot: "/tmp/acepe" })
		.pipe(
			Stream.runForEach((event) => Queue.offer(events, event).pipe(Effect.asVoid)),
			Effect.forkChild({ startImmediately: true })
		)
	const opened = yield* Queue.take(events)
	return { adapter, events, inbound, recorded, replies, promptDone, cancels, opened }
})

// Takes events until the typed one arrives, and fails the moment the same
// fact turns up folded into a generic SessionMetaUpdated instead — the exact
// blindness issue #282 reports.
const nextTypedEvent = <A extends OrchestrationEvent>(
	type: A["type"],
	foldedContractKinds: ReadonlyArray<string>
) =>
	Effect.fn("nextTypedEvent")(function*(events: Queue.Queue<OrchestrationEvent, Done>) {
		for (let attempt = 0; attempt < 8; attempt++) {
			const next = yield* Queue.take(events)
			if (next.type === "SessionMetaUpdated") {
				const fact = decodeContractFact(next.metadata)
				if (Option.isSome(fact)) {
					Vitest.assert.isFalse(
						Arr.contains(foldedContractKinds, fact.value.contractKind),
						`${fact.value.contractKind} folded into SessionMetaUpdated instead of ${type}`
					)
				}
			}
			if (next.type === type) {
				return next as A
			}
		}
		return Vitest.assert.fail(`no ${type} event arrived`)
	})

const nextToolCallObserved = nextTypedEvent<ToolCallObservedEvent>("ToolCallObserved", [
	"tool_call",
	"tool_call_update"
])
const nextApprovalRequested = nextTypedEvent<ApprovalRequestedEvent>("ApprovalRequested", [
	"permission_request"
])
const nextTurnUsageObserved = nextTypedEvent<TurnUsageObservedEvent>("TurnUsageObserved", [
	"usage"
])
const nextTurnCompleted = nextTypedEvent<TurnCompletedEvent>("TurnCompleted", [
	"turn_complete",
	"turn_error"
])

// The real shape: a JSON-RPC request the agent blocks on, whose params name
// the tool call and the options an answer may pick from. Acepe derives the
// approval id from the tool call id, because ACP gives the client none.
const acpPermissionRequest: Json = {
	jsonrpc: "2.0",
	id: 41,
	method: "session/request_permission",
	params: {
		sessionId: "acp-copilot-1",
		toolCall: {
			toolCallId: "tool-1",
			kind: "execute",
			title: "Run bun test"
		},
		options: [
			{ optionId: "allow-once", name: "Allow once", kind: "allow_once" },
			{ optionId: "reject-once", name: "Reject", kind: "reject_once" }
		]
	}
}

const toolCallUpdate: Json = {
	sessionUpdate: "tool_call",
	toolCallId: "tool-1",
	title: "Read src/app.ts",
	kind: "read",
	status: "pending",
	rawInput: { path: "/tmp/acepe/src/app.ts" }
}

Vitest.describe("CopilotAdapter", () => {
	Vitest.it.effect("opens a session through ACP session/new with empty mcpServers", () =>
		Effect.gen(function*() {
			const session = yield* startTestSession()
			Vitest.assert.strictEqual(session.opened.type, "SessionMetaUpdated")
			const fact = decodeContractFact(session.opened.metadata)
			Vitest.assert.isTrue(Option.isSome(fact))
			if (Option.isSome(fact) && fact.value.contractKind === "provider_session") {
				Vitest.assert.strictEqual(fact.value.providerSessionId, "acp-copilot-1")
			}
			const requests = yield* Ref.get(session.recorded)
			// Copilot rejects a session/new that arrives before the ACP
			// handshake, so the order matters as much as the params.
			Vitest.assert.deepStrictEqual(
				Arr.map(requests, (request) => request.method),
				["initialize", "session/new"]
			)
			const sessionNew = Arr.findFirst(requests, (request) => request.method === "session/new")
			Vitest.assert.isTrue(Option.isSome(sessionNew))
			if (Option.isSome(sessionNew)) {
				Vitest.assert.deepStrictEqual(sessionNew.value.params, {
					cwd: "/tmp/acepe",
					mcpServers: Arr.empty()
				})
			}
			yield* session.adapter.cancelTurn({ sessionId })
			yield* Queue.end(session.inbound)
		})
	)

	// Copilot advertises its session modes as ACP mode URIs (see
	// normalizeCopilotModeId), so the plain "plan" a session.set-mode carries
	// has to leave the adapter as the URI form the agent recognises.
	Vitest.it.effect("sends a set mode as ACP session/set_mode with Copilot's mode URI", () =>
		Effect.gen(function*() {
			const session = yield* startTestSession()
			yield* session.adapter.setMode({ sessionId, modeId: "plan" })
			const requests = yield* Ref.get(session.recorded)
			const setMode = Arr.findFirst(
				requests,
				(request) => request.method === "session/set_mode"
			)
			Vitest.assert.isTrue(Option.isSome(setMode))
			if (Option.isSome(setMode)) {
				Vitest.assert.deepStrictEqual(setMode.value.params, {
					sessionId: "acp-copilot-1",
					modeId: "https://agentclientprotocol.com/protocol/session-modes#plan"
				})
			}
			yield* Queue.end(session.inbound)
		})
	)

	Vitest.it.effect("streams TokenAppended from ACP agent_message_chunk updates", () =>
		Effect.gen(function*() {
			const session = yield* startTestSession()
			const sent = yield* Stream.runCollect(
				session.adapter.sendPrompt({ sessionId, messageId, text: "Hi" })
			)
			Vitest.assert.strictEqual(sent[0]?.type, "MessageSent")
			yield* Queue.offer(session.inbound, {
				sessionUpdate: "agent_message_chunk",
				content: { type: "text", text: "Hello" }
			})
			const tokenEvent = yield* takeUntil(
				session.events,
				(event) => event.type === "TokenAppended"
			)
			if (tokenEvent.type === "TokenAppended") {
				Vitest.assert.strictEqual(tokenEvent.payload.token, "Hello")
				Vitest.assert.strictEqual(
					tokenEvent.payload.messageId,
					tracerAssistantMessageId(messageId)
				)
			}
			yield* Deferred.succeed(session.promptDone, { stopReason: "end_turn" })
			yield* session.adapter.cancelTurn({ sessionId })
			yield* Queue.end(session.inbound)
		})
	)

	// #282: a real Copilot tool call has to reach ProjectionSessionActivities
	// as a ToolCallObserved event. Folded into SessionMetaUpdated it produces
	// no activity row at all.
	Vitest.it.effect("publishes an ACP tool call as a ToolCallObserved event", () =>
		Effect.gen(function*() {
			const session = yield* startTestSession()
			yield* Queue.offer(session.inbound, toolCallUpdate)
			const observed = yield* nextToolCallObserved(session.events)
			Vitest.assert.strictEqual(observed.payload.toolCallId, "tool-1")
			Vitest.assert.strictEqual(observed.payload.activityId, "tool-1:activity")
			Vitest.assert.strictEqual(observed.payload.status, "pending")
			Vitest.assert.strictEqual(observed.payload.title, "Read src/app.ts")
			Vitest.assert.strictEqual(observed.payload.kind, "read")
			Vitest.assert.strictEqual(observed.payload.path, "/tmp/acepe/src/app.ts")
			Vitest.assert.strictEqual(observed.payload.output, null)
			yield* Queue.end(session.inbound)
		})
	)

	// #273 for Copilot: the settling update carries the tool's result, and the
	// row it settles keeps the title the start recorded.
	Vitest.it.effect("carries a settled tool call's output onto the same activity row", () =>
		Effect.gen(function*() {
			const session = yield* startTestSession()
			yield* Queue.offer(session.inbound, toolCallUpdate)
			yield* nextToolCallObserved(session.events)
			yield* Queue.offer(session.inbound, {
				sessionUpdate: "tool_call_update",
				toolCallId: "tool-1",
				status: "completed",
				content: [{ type: "content", content: { type: "text", text: "export const app = 1" } }]
			})
			const settled = yield* nextToolCallObserved(session.events)
			Vitest.assert.strictEqual(settled.payload.activityId, "tool-1:activity")
			Vitest.assert.strictEqual(settled.payload.status, "completed")
			Vitest.assert.strictEqual(settled.payload.title, "Read src/app.ts")
			Vitest.assert.strictEqual(settled.payload.path, "/tmp/acepe/src/app.ts")
			Vitest.assert.strictEqual(settled.payload.output, "export const app = 1")
			yield* Queue.end(session.inbound)
		})
	)

	// #282: ProjectionPendingApprovals only reacts to a typed
	// ApprovalRequested event, so a Copilot permission prompt folded into
	// SessionMetaUpdated leaves the desktop with nothing to render.
	Vitest.it.effect("publishes an ACP permission request as an ApprovalRequested event", () =>
		Effect.gen(function*() {
			const session = yield* startTestSession()
			yield* Queue.offer(session.inbound, {
				sessionUpdate: "permissionRequest",
				permissionRequest: {
					id: "perm-tool-1",
					sessionId: "acp-copilot-1",
					permission: "execute",
					toolCallId: "tool-1"
				}
			})
			const requested = yield* nextApprovalRequested(session.events)
			Vitest.assert.strictEqual(requested.payload.approvalRequestId, "perm-tool-1")
			Vitest.assert.strictEqual(requested.payload.title, "execute")
			yield* Queue.end(session.inbound)
		})
	)

	// ACP asks for a permission with a JSON-RPC REQUEST the agent blocks on,
	// not a notification: the turn stops until a reply carrying the same id
	// arrives. Nothing answered one before, so a Copilot turn that hit a
	// permission gate hung there for good.
	Vitest.it.effect("answers an ACP permission request with the option the decision picks", () =>
		Effect.gen(function*() {
			const session = yield* startTestSession()
			yield* Queue.offer(session.inbound, acpPermissionRequest)
			const requested = yield* nextApprovalRequested(session.events)
			Vitest.assert.strictEqual(requested.payload.approvalRequestId, "perm-tool-1")
			yield* session.adapter.respondToPermission({
				sessionId,
				permissionId: "perm-tool-1",
				decision: "allow"
			})
			Vitest.assert.deepStrictEqual(yield* Ref.get(session.replies), [
				{
					id: 41,
					result: { outcome: { outcome: "selected", optionId: "allow-once" } }
				}
			])
			yield* Queue.end(session.inbound)
		})
	)

	// The agent is blocked on the reply, so a cancel that walks away from the
	// permission has to answer it as cancelled, and clear the approval's row
	// too — otherwise the desktop keeps a clickable approval for a dead turn.
	Vitest.it.effect("cancels an unanswered permission when the turn is cancelled", () =>
		Effect.gen(function*() {
			const session = yield* startTestSession()
			yield* Queue.offer(session.inbound, acpPermissionRequest)
			yield* nextApprovalRequested(session.events)
			yield* session.adapter.cancelTurn({ sessionId })
			Vitest.assert.deepStrictEqual(yield* Ref.get(session.replies), [
				{ id: 41, result: { outcome: { outcome: "cancelled" } } }
			])
			const answered = yield* takeUntil(session.events, (event) => {
				if (event.type !== "SessionMetaUpdated") {
					return false
				}
				const fact = decodePendingApprovalFact(event.metadata[PENDING_APPROVAL_METADATA_KEY])
				return Option.isSome(fact) && fact.value.type === "ApprovalAnswered"
			})
			Vitest.assert.strictEqual(answered.type, "SessionMetaUpdated")
			yield* Queue.end(session.inbound)
		})
	)

	// #274 / #282: the deterministic dedup key Map.ts already derives has to
	// ride the canonical payload, or the desktop counts a redelivered reading
	// twice.
	Vitest.it.effect("publishes a usage update as TurnUsageObserved carrying its eventId", () =>
		Effect.gen(function*() {
			const session = yield* startTestSession()
			yield* Queue.offer(session.inbound, {
				sessionUpdate: "usage",
				sessionId: "acp-copilot-1",
				inputTokens: 12,
				outputTokens: 4,
				totalTokens: 16,
				size: 128000
			})
			const usage = yield* nextTurnUsageObserved(session.events)
			Vitest.assert.strictEqual(usage.payload.inputTokens, 12)
			Vitest.assert.strictEqual(usage.payload.outputTokens, 4)
			Vitest.assert.strictEqual(usage.payload.totalTokens, 16)
			Vitest.assert.strictEqual(usage.payload.contextWindowSize, 128000)
			Vitest.assert.strictEqual(
				usage.payload.eventId,
				"copilot-token-usage:acp-copilot-1:total=16:input=12:output=4:cost=none:context=128000"
			)
			yield* Queue.end(session.inbound)
		})
	)

	Vitest.it.effect("cancelTurn notifies session/cancel and emits TurnCancelled", () =>
		Effect.gen(function*() {
			const session = yield* startTestSession()
			yield* session.adapter.cancelTurn({ sessionId })
			const cancelled = yield* takeUntil(
				session.events,
				(event) => event.type === "TurnCancelled"
			)
			Vitest.assert.strictEqual(cancelled.type, "TurnCancelled")
			Vitest.assert.strictEqual(yield* Ref.get(session.cancels), 1)
			const requests = yield* Ref.get(session.recorded)
			const cancel = Arr.findFirst(requests, (request) => request.method === "session/cancel")
			Vitest.assert.isTrue(Option.isSome(cancel))
			if (Option.isSome(cancel)) {
				Vitest.assert.deepStrictEqual(cancel.value.params, {
					sessionId: "acp-copilot-1"
				})
			}
			yield* Queue.end(session.inbound)
		})
	)

	Vitest.it.effect("steers into the active turn instead of opening a second turn", () =>
		Effect.gen(function*() {
			const session = yield* startTestSession()
			yield* Stream.runCollect(
				session.adapter.sendPrompt({ sessionId, messageId, text: "First" })
			)
			yield* Stream.runCollect(
				session.adapter.sendPrompt({
					sessionId,
					messageId: steerMessageId,
					text: "Steer"
				})
			)
			const prompts = Arr.filter(
				yield* Ref.get(session.recorded),
				(request) => request.method === "session/prompt"
			)
			Vitest.assert.strictEqual(prompts.length, 2)
			yield* Deferred.succeed(session.promptDone, { stopReason: "end_turn" })
			const completed = yield* nextTurnCompleted(session.events)
			Vitest.assert.strictEqual(completed.payload.turnId, "session-1:turn:1")
			yield* session.adapter.cancelTurn({ sessionId })
			yield* Queue.end(session.inbound)
		})
	)

	// A settled prompt is the only thing that closes an open projection_turns
	// row for Copilot: the row stays "running" forever otherwise, which the
	// composer shows as a turn stuck on "Interrupt" (see projectTurnCompleted
	// in ProjectionTurns.ts). Folded into SessionMetaUpdated the fact reaches
	// evolveProjectedTurns' no-op branch.
	Vitest.it.effect("closes a settled turn with a TurnCompleted event naming the turn", () =>
		Effect.gen(function*() {
			const session = yield* startTestSession()
			yield* Stream.runCollect(
				session.adapter.sendPrompt({ sessionId, messageId, text: "Hi" })
			)
			yield* Deferred.succeed(session.promptDone, { stopReason: "end_turn" })
			const completed = yield* nextTurnCompleted(session.events)
			Vitest.assert.strictEqual(completed.payload.sessionId, sessionId)
			Vitest.assert.strictEqual(completed.payload.turnId, "session-1:turn:1")
			yield* Queue.end(session.inbound)
		})
	)

	// projection_turns has no "failed" status, so a refused turn closes as
	// completed rather than staying open — the same call Codex and OpenCode
	// already make for their own turn_error.
	Vitest.it.effect("closes a refused turn with TurnCompleted too", () =>
		Effect.gen(function*() {
			const session = yield* startTestSession()
			yield* Stream.runCollect(
				session.adapter.sendPrompt({ sessionId, messageId, text: "Hi" })
			)
			yield* Deferred.succeed(session.promptDone, { stopReason: "refusal" })
			const completed = yield* nextTurnCompleted(session.events)
			Vitest.assert.strictEqual(completed.payload.turnId, "session-1:turn:1")
			yield* Queue.end(session.inbound)
		})
	)
})
