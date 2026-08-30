import {
	type OrchestrationEvent,
	type SessionModelCatalog,
	MessageId,
	ProjectId,
	SessionId,
	tracerAssistantMessageId,
	TurnId
} from "@acepe/contracts"
import * as Vitest from "@effect/vitest"
import type { Done } from "effect/Cause"
import * as Deferred from "effect/Deferred"
import * as Duration from "effect/Duration"
import * as Effect from "effect/Effect"
import * as Fiber from "effect/Fiber"
import * as Option from "effect/Option"
import * as Queue from "effect/Queue"
import * as Ref from "effect/Ref"
import * as Result from "effect/Result"
import * as Stream from "effect/Stream"
import {
	evolveProjectedPendingApprovals,
	type ProjectedPendingApproval
} from "../../../persistence/Services/ProjectionPendingApprovals.ts"
import type { Json } from "../Json.ts"
import { decodeSessionModelsFact } from "../SessionModelsFact.ts"
import { makeClaudeAdapter, type ClaudeAdapterOptions } from "./Adapter.ts"
import { decodeContractFact } from "./Codec.ts"
import type { ClaudeQueryHandle, ClaudeQueryInput } from "./Process.ts"
import { adapterError, claudePresence, type ClaudeMode } from "./Provider.ts"
import type { ClaudeCanUseTool, ClaudePermissionResult } from "./Wire.ts"

const sessionId = SessionId.make("session-1")
const projectId = ProjectId.make("project-1")
const messageId = MessageId.make("message-user")
const messageId2 = MessageId.make("message-user-2")

// What the scripted SDK answers when the adapter asks what it can run --
// deliberately NOT the five ids the deleted CLAUDE_PROVIDER_MODELS constant
// held, so a test can only pass by reading the provider's own answer.
const SCRIPTED_MODELS: SessionModelCatalog = [
	{ modelId: "claude-opus-5", name: "Opus 5", description: "Most capable model" },
	{ modelId: "claude-sonnet-5", name: "Sonnet 5", description: null }
]

const fakeHandle = (
	inbound: Queue.Queue<Json, Done>,
	interrupts: Ref.Ref<number>
): ClaudeQueryHandle => ({
	messages: Stream.fromQueue(inbound),
	interrupt: Ref.update(interrupts, (count) => count + 1).pipe(Effect.asVoid),
	setPermissionMode: () => Effect.void,
	setModel: () => Effect.void,
	supportedModels: Effect.succeed(SCRIPTED_MODELS),
	close: Queue.end(inbound).pipe(Effect.asVoid)
})

// A scripted SDK stand-in that, unlike fakeHandle above, mints a genuinely
// FRESH query (its own inbound queue) on every createQuery call — exactly
// what the real @anthropic-ai/claude-agent-sdk does on every query() call.
// This is what lets a test observe attachQuery's restart behavior: cancelling
// or a watchdog recovery must produce a SECOND scripted attempt, not silently
// keep feeding the first (already-ended) one.
type ScriptedAttempt = {
	readonly inbound: Queue.Queue<Json, Done>
	readonly interrupted: Ref.Ref<boolean>
	readonly closed: Ref.Ref<boolean>
	readonly resume: Option.Option<string>
	// The mode this attempt was LAUNCHED in, and the live setPermissionMode
	// control requests it received afterwards — the two halves of Claude's
	// mode mechanism, both observable per attempt.
	readonly permissionMode: ClaudeMode
	readonly modeRequests: Ref.Ref<ReadonlyArray<ClaudeMode>>
	// The same two halves for the model: the id this attempt was LAUNCHED
	// with, and the live setModel control requests it received afterwards.
	readonly model: Option.Option<string>
	readonly modelRequests: Ref.Ref<ReadonlyArray<string>>
}

const makeScriptedClaudeSdk = Effect.fn("makeScriptedClaudeSdk")(function*() {
	const attemptsRef = yield* Ref.make<ReadonlyArray<ScriptedAttempt>>([])
	const createQuery = (input: ClaudeQueryInput) =>
		Effect.gen(function*() {
			const inbound = yield* Queue.unbounded<Json, Done>()
			const interrupted = yield* Ref.make(false)
			const closed = yield* Ref.make(false)
			const modeRequests = yield* Ref.make<ReadonlyArray<ClaudeMode>>([])
			const modelRequests = yield* Ref.make<ReadonlyArray<string>>([])
			const attempt: ScriptedAttempt = {
				inbound,
				interrupted,
				closed,
				resume: input.resume,
				permissionMode: input.permissionMode,
				modeRequests,
				model: input.model,
				modelRequests
			}
			yield* Ref.update(attemptsRef, (current) => [...current, attempt])
			return {
				messages: Stream.fromQueue(inbound),
				interrupt: Ref.set(interrupted, true).pipe(Effect.asVoid),
				setPermissionMode: (mode: ClaudeMode) =>
					Ref.update(modeRequests, (current) => [...current, mode]).pipe(Effect.asVoid),
				setModel: (model: string) =>
					Ref.update(modelRequests, (current) => [...current, model]).pipe(Effect.asVoid),
				supportedModels: Effect.succeed(SCRIPTED_MODELS),
				close: Ref.set(closed, true).pipe(
					Effect.andThen(Queue.end(inbound)),
					Effect.asVoid
				)
			} satisfies ClaudeQueryHandle
		})
	return { createQuery, attemptsRef }
})

const waitUntil = <A, E, R>(
	effect: Effect.Effect<A, E, R>,
	predicate: (value: A) => boolean,
	attempts = 200
): Effect.Effect<A, E, R> =>
	Effect.gen(function*() {
		let last = yield* effect
		let remaining = attempts
		while (!predicate(last) && remaining > 0) {
			yield* Effect.sleep(Duration.millis(5))
			last = yield* effect
			remaining -= 1
		}
		return last
	})

// A bounded take, so a regression that publishes FEWER events than a helper
// scans for fails right here with the reason, instead of blocking on
// Queue.take until vitest's own timeout kills the file with no clue which
// wait died. Only sound in the it.live tests below — under it.effect's
// TestClock this timeout would never fire.
const EVENT_TIMEOUT = Duration.millis(500)

const nextEvent = Effect.fn("nextEvent")(function*(
	events: Queue.Queue<OrchestrationEvent, Done>
) {
	const next = yield* Queue.take(events).pipe(Effect.timeoutOption(EVENT_TIMEOUT))
	if (Option.isNone(next)) {
		return Vitest.assert.fail("the adapter published no further event within 500ms")
	}
	return next.value
})

// The catalog the adapter published, read off whichever SessionMetaUpdated
// event carries the session_models fact. Scanned rather than positional: the
// list arrives from its own fiber (the provider is asked over the transport,
// which takes as long as it takes), so its position among the session's first
// events is not something a test may pin down.
const takeSessionModels = Effect.fn("takeSessionModels")(function*(
	events: Queue.Queue<OrchestrationEvent, Done>
) {
	for (let attempt = 0; attempt < 8; attempt++) {
		const next = yield* nextEvent(events)
		if (next.type !== "SessionMetaUpdated") {
			continue
		}
		const fact = decodeSessionModelsFact(next.metadata)
		if (Option.isSome(fact)) {
			return fact.value.models
		}
	}
	return Vitest.assert.fail("the adapter never published the models its provider reported")
})

// The catalog event lands among a session's first events, from its own fiber
// (see publishSupportedModels), so a test that wants one specific event may no
// longer count positions after deferred_open. Only deferred_open itself is
// positional, because startSession concatenates it ahead of the outbound queue.
const takeEventOfType = Effect.fn("takeEventOfType")(function*(
	events: Queue.Queue<OrchestrationEvent, Done>,
	type: OrchestrationEvent["type"]
) {
	for (let attempt = 0; attempt < 8; attempt++) {
		const next = yield* Queue.take(events)
		if (next.type === type) {
			return next
		}
	}
	return Vitest.assert.fail(`the adapter published no ${type} event`)
})

// Drives a session into the exact state the abandoned-permission tests
// need: the SDK's own canUseTool callback is blocked on decidePermission's
// Deferred (see Permissions.ts) and the matching ApprovalRequested event
// has already been observed. The returned fiber is what a test joins to see
// how the path that abandoned that permission resolved the SDK's promise.
const forkBlockedPermission = Effect.fn("forkBlockedPermission")(function*(
	canUseTool: ClaudeCanUseTool,
	events: Queue.Queue<OrchestrationEvent, Done>
) {
	const decisionFiber = yield* Effect.promise(() =>
		canUseTool("Edit", { file_path: "/tmp/acepe/a.txt" }, { toolUseID: "toolu_abandoned" })
	).pipe(Effect.forkChild({ startImmediately: true }))
	let requested = false
	for (let attempt = 0; attempt < 5 && !requested; attempt++) {
		const next = yield* nextEvent(events)
		if (next.type === "ApprovalRequested") {
			requested = true
		}
	}
	Vitest.assert.isTrue(requested, "expected an ApprovalRequested event before abandoning it")
	return decisionFiber
})

// Generous next to every other timing bound in this file (30-50ms): a
// pending permission that is going to be resolved at all is resolved by the
// abandoning path itself, synchronously, so anything past this is the
// forever-hang the tests below exist to catch.
const ABANDONED_DECISION_TIMEOUT = Duration.seconds(2)

// Folds what the adapter actually publishes through the REAL projector, so
// the assertion is "projection_pending_approvals no longer holds the row",
// not "the metadata looks about right". Gives up while the row is still
// there once the adapter goes quiet — the stale-approval bug itself.
const projectUntilCleared = Effect.fn("projectUntilCleared")(function*(
	events: Queue.Queue<OrchestrationEvent, Done>,
	seed: ReadonlyArray<ProjectedPendingApproval>
) {
	let rows = seed
	for (let attempt = 0; attempt < 8 && rows.length > 0; attempt++) {
		const next = yield* Queue.take(events).pipe(
			Effect.timeoutOption(Duration.millis(200)),
			Effect.orElseSucceed(() => Option.none<OrchestrationEvent>())
		)
		if (Option.isNone(next)) {
			return rows
		}
		rows = yield* evolveProjectedPendingApprovals(rows, next.value)
	}
	return rows
})

// Same setup as forkBlockedPermission, but hands the ApprovalRequested event
// back so a test can seed the real projector with the row the drain has to
// clear.
const forkProjectedPermission = Effect.fn("forkProjectedPermission")(function*(
	canUseTool: ClaudeCanUseTool,
	events: Queue.Queue<OrchestrationEvent, Done>
) {
	yield* Effect.promise(() =>
		canUseTool("Edit", { file_path: "/tmp/acepe/a.txt" }, { toolUseID: "toolu_abandoned" })
	).pipe(Effect.forkChild({ startImmediately: true }))
	for (let attempt = 0; attempt < 5; attempt++) {
		const next = yield* nextEvent(events)
		if (next.type === "ApprovalRequested") {
			return yield* evolveProjectedPendingApprovals([], next)
		}
	}
	return Vitest.assert.fail("expected an ApprovalRequested event before abandoning it")
})

// The arrange block nearly every test below needs, in one place: an adapter
// over `createQuery`, a started session feeding an event queue, and the
// SDK's own canUseTool callback captured from the query the adapter
// attached. The timeout defaults are the production ones for the watchdog
// (so it never fires inside a test) and the short cancel bound the
// cancel/shutdown tests use.
type TestSessionOptions = {
	readonly createQuery: ClaudeAdapterOptions["createQuery"]
	readonly prompt?: string
	readonly cancelInterruptTimeout?: Duration.Input
	readonly turnInactivityTimeout?: Duration.Input
	readonly permissionWaitTimeout?: Duration.Input
	readonly watchdogPollInterval?: Duration.Input
}

const startTestSession = Effect.fn("startTestSession")(function*(
	options: TestSessionOptions
) {
	let capturedCanUseTool: ClaudeCanUseTool | undefined
	const adapter = yield* makeClaudeAdapter({
		presence: Effect.succeed(claudePresence(true, true)),
		createQuery: (input) => {
			capturedCanUseTool = input.canUseTool
			return options.createQuery(input)
		},
		cancelInterruptTimeout: options.cancelInterruptTimeout ?? Duration.millis(50),
		turnInactivityTimeout: options.turnInactivityTimeout ?? Duration.seconds(60),
		permissionWaitTimeout: options.permissionWaitTimeout ?? Duration.minutes(30),
		watchdogPollInterval: options.watchdogPollInterval ?? Duration.seconds(5)
	})
	const events = yield* Queue.unbounded<OrchestrationEvent, Done>()
	yield* adapter
		.startSession({ sessionId, projectId, workspaceRoot: "/tmp/acepe", envOverrides: {} })
		.pipe(
			Stream.runForEach((event) => Queue.offer(events, event).pipe(Effect.asVoid)),
			Effect.forkChild({ startImmediately: true })
		)
	// Readable only AFTER the deferred_open event proves openSession ran: the
	// session stream is unwrapped lazily, so createQuery has not necessarily
	// been called by the time this returns.
	const canUseTool = () =>
		capturedCanUseTool ??
			Vitest.assert.fail("expected createQuery to receive a canUseTool callback")
	return { adapter, events, canUseTool }
})

// startTestSession, plus the deferred_open event taken and a first prompt
// sent — where every test that needs a turn already open begins.
const openPromptedSession = Effect.fn("openPromptedSession")(function*(
	options: TestSessionOptions
) {
	const session = yield* startTestSession(options)
	yield* Queue.take(session.events) // deferred_open
	yield* Stream.runCollect(
		session.adapter.sendPrompt({
			sessionId,
			messageId,
			text: options.prompt ?? "Edit a file for me"
		})
	)
	return {
		adapter: session.adapter,
		events: session.events,
		canUseTool: session.canUseTool()
	}
})

// openPromptedSession plus the permission the SDK is already blocked on:
// the exact state the four abandoned-permission tests share.
const withBlockedPermission = Effect.fn("withBlockedPermission")(function*(
	options: TestSessionOptions
) {
	const session = yield* openPromptedSession(options)
	const decisionFiber = yield* forkBlockedPermission(session.canUseTool, session.events)
	return { adapter: session.adapter, events: session.events, decisionFiber }
})

// Joins the fiber the SDK's canUseTool promise runs on and asserts the
// abandoning path denied it. An unbounded join IS the forever-hang these
// tests exist to catch, hence the timeout rather than a plain join.
const assertAbandonedDenial = Effect.fn("assertAbandonedDenial")(function*(
	decisionFiber: Fiber.Fiber<ClaudePermissionResult>,
	message: string
) {
	const decision = yield* Fiber.join(decisionFiber).pipe(
		Effect.timeoutOption(ABANDONED_DECISION_TIMEOUT)
	)
	if (Option.isNone(decision)) {
		return Vitest.assert.fail(message)
	}
	Vitest.assert.strictEqual(decision.value.behavior, "deny")
})

Vitest.describe("ClaudeAdapter", () => {
	Vitest.it.effect("emits deferred_open before the SDK session id exists", () =>
		Effect.gen(function*() {
			const inbound = yield* Queue.unbounded<Json, Done>()
			const interrupts = yield* Ref.make(0)
			const { adapter, events } = yield* startTestSession({
				createQuery: () => Effect.succeed(fakeHandle(inbound, interrupts))
			})
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
			const { adapter, events } = yield* openPromptedSession({
				createQuery: () => Effect.succeed(fakeHandle(inbound, interrupts)),
				prompt: "Hi"
			})
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
			const tokenEvent = yield* takeEventOfType(events, "TokenAppended")
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

	// Reproduces the live bug: a real Claude turn's reply fully lands (the SDK
	// stream delivers a `result` message once Claude finishes replying) but
	// nothing closed projection_turns for it — no TurnCompleted event ever
	// appended, so the turn stayed "running" forever. Map.ts's mapSdkMessage
	// already turns the SDK's `result` message into a `turn_complete` fact;
	// this pins down that ClaudeAdapter publishes that fact as a TurnCompleted
	// contract event instead of folding it into a generic SessionMetaUpdated.
	Vitest.it.effect("emits TurnCompleted when the SDK stream delivers a result message", () =>
		Effect.gen(function*() {
			const inbound = yield* Queue.unbounded<Json, Done>()
			const interrupts = yield* Ref.make(0)
			const { adapter, events } = yield* openPromptedSession({
				createQuery: () => Effect.succeed(fakeHandle(inbound, interrupts)),
				prompt: "Reply with exactly: TURN_42"
			})
			yield* Queue.offer(inbound, {
				type: "stream_event",
				session_id: "sdk-session-1",
				event: {
					type: "content_block_delta",
					delta: {
						type: "text_delta",
						text: "TURN_42"
					}
				}
			})
			yield* Queue.take(events)
			yield* Queue.offer(inbound, {
				type: "result",
				session_id: "sdk-session-1",
				is_error: false,
				usage: { input_tokens: 3, output_tokens: 2 }
			})
			// The result message also carries usage, which still legitimately
			// becomes a SessionMetaUpdated fact — only the terminal turn_complete
			// fact changes destination, so drain up to a small bound of
			// intervening events instead of asserting every event is terminal.
			let completed: OrchestrationEvent | undefined
			for (let attempt = 0; attempt < 5 && completed === undefined; attempt++) {
				const next = yield* Queue.take(events)
				if (next.type === "TurnCompleted") {
					completed = next
				}
			}
			if (completed === undefined || completed.type !== "TurnCompleted") {
				Vitest.assert.fail("expected a TurnCompleted event after the SDK result message")
				return
			}
			Vitest.assert.strictEqual(completed.payload.sessionId, sessionId)
			yield* adapter.cancelTurn({ sessionId })
		})
	)

	// Reproduces the live QA bug head-on: a real Claude tool call executes
	// (the SDK emits a tool_use start, then the tool_result completing it) but
	// ZERO ToolCall* events ever reached orchestration_events -- both facts
	// were folded into a generic SessionMetaUpdated, which
	// ProjectionSessionActivities.ts has no case for. Map.ts's mapSdkMessage
	// already turns the SDK's tool_use/tool_result into tool_call/tool_call_update
	// facts; this pins down that ClaudeAdapter publishes them as
	// ToolCallObserved contract events (same shape as the tracer's
	// ToolCallObserveCommand decider produces), not SessionMetaUpdated.
	Vitest.it.effect(
		"emits ToolCallObserved (in_progress then completed) for a real tool call, not SessionMetaUpdated",
		() =>
			Effect.gen(function*() {
				const inbound = yield* Queue.unbounded<Json, Done>()
				const interrupts = yield* Ref.make(0)
				const { adapter, events } = yield* openPromptedSession({
					createQuery: () => Effect.succeed(fakeHandle(inbound, interrupts)),
					prompt: "Read package.json"
				})
				yield* Queue.offer(inbound, {
					type: "stream_event",
					session_id: "sdk-session-1",
					event: {
						type: "content_block_start",
						index: 0,
						content_block: {
							type: "tool_use",
							id: "toolu_01ReadPkg",
							name: "Read",
							input: { file_path: "/tmp/acepe/package.json" }
						}
					}
				})
				let started: OrchestrationEvent | undefined
				for (let attempt = 0; attempt < 5 && started === undefined; attempt++) {
					const next = yield* Queue.take(events)
					// SessionMetaUpdated is still legitimate for OTHER facts (e.g. the
					// provider_session promotion this same message also carries) --
					// only a tool_call/tool_call_update fact must never land there.
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
					Vitest.assert.fail("expected a ToolCallObserved event for the tool_use start")
					return
				}
				Vitest.assert.strictEqual(started.payload.status, "in_progress")
				Vitest.assert.strictEqual(started.payload.title, "Read /tmp/acepe/package.json")
				Vitest.assert.strictEqual(started.payload.toolCallId, "toolu_01ReadPkg")
				Vitest.assert.strictEqual(started.payload.path, "/tmp/acepe/package.json")
				// The tool's own arguments ride on the start event: the panel
				// shows a Bash command, or an Edit's proposed content, from
				// these and nothing else.
				Vitest.assert.deepStrictEqual(started.payload.input, {
					file_path: "/tmp/acepe/package.json"
				})

				yield* Queue.offer(inbound, {
					type: "user",
					session_id: "sdk-session-1",
					message: {
						role: "user",
						content: [
							{
								type: "tool_result",
								tool_use_id: "toolu_01ReadPkg",
								content: "{\"name\":\"acepe\"}",
								is_error: false
							}
						]
					}
				})
				let completed: OrchestrationEvent | undefined
				for (let attempt = 0; attempt < 5 && completed === undefined; attempt++) {
					const next = yield* Queue.take(events)
					if (next.type === "SessionMetaUpdated") {
						const fact = decodeContractFact(next.metadata)
						if (Option.isSome(fact)) {
							Vitest.assert.notStrictEqual(fact.value.contractKind, "tool_call")
							Vitest.assert.notStrictEqual(fact.value.contractKind, "tool_call_update")
						}
					}
					if (next.type === "ToolCallObserved") {
						completed = next
					}
				}
				if (completed === undefined || completed.type !== "ToolCallObserved") {
					Vitest.assert.fail("expected a ToolCallObserved event for the tool_result completion")
					return
				}
				Vitest.assert.strictEqual(completed.payload.status, "completed")
				// Same activityId across start -> completion, so the projector
				// merges them into ONE row instead of two.
				Vitest.assert.strictEqual(completed.payload.activityId, started.payload.activityId)
				Vitest.assert.strictEqual(completed.payload.toolCallId, "toolu_01ReadPkg")
				// #273: Claude's tool_result block carries the content the tool
				// produced, and it now travels to the observation the panel
				// reads -- a Bash row used to render as a bare title with no
				// command and no output under it.
				Vitest.assert.strictEqual(completed.payload.output, "{\"name\":\"acepe\"}")
				// The settling event repeats the arguments the start recorded,
				// for the same reason it repeats title, path and kind: a client
				// that rebuilds the tool row from the latest observation would
				// otherwise lose the command or the proposed content the moment
				// the call completes.
				Vitest.assert.deepStrictEqual(completed.payload.input, {
					file_path: "/tmp/acepe/package.json"
				})
				yield* adapter.cancelTurn({ sessionId })
			})
	)

	// AC-269: a real Claude usage_update message used to fold into a generic
	// SessionMetaUpdated event -- no projector reads its metadata, so nothing
	// downstream could show the working line's live token count (same swallow
	// pattern the ToolCallObserved test above already proved and fixed for
	// tool calls). Pins down that ClaudeAdapter publishes a typed
	// TurnUsageObserved event instead, carrying the current turn's id.
	Vitest.it.effect(
		"emits TurnUsageObserved for a real usage_update message, not SessionMetaUpdated",
		() =>
			Effect.gen(function*() {
				const inbound = yield* Queue.unbounded<Json, Done>()
				const interrupts = yield* Ref.make(0)
				const { adapter, events } = yield* openPromptedSession({
					createQuery: () => Effect.succeed(fakeHandle(inbound, interrupts)),
					prompt: "Read package.json"
				})
				yield* Queue.offer(inbound, {
					type: "system",
					subtype: "usage_update",
					session_id: "sdk-session-1",
					usage: {
						input_tokens: 120,
						output_tokens: 48,
						total_tokens: 168
					},
					total_cost_usd: 0.0123,
					size: 200_000
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
					Vitest.assert.fail("expected a TurnUsageObserved event for the usage_update message")
					return
				}
				Vitest.assert.strictEqual(observed.payload.sessionId, sessionId)
				Vitest.assert.strictEqual(observed.payload.turnId, TurnId.make(messageId))
				Vitest.assert.strictEqual(observed.payload.inputTokens, 120)
				Vitest.assert.strictEqual(observed.payload.outputTokens, 48)
				Vitest.assert.strictEqual(observed.payload.totalTokens, 168)
				Vitest.assert.strictEqual(observed.payload.costUsd, 0.0123)
				Vitest.assert.strictEqual(observed.payload.contextWindowSize, 200_000)
				yield* adapter.cancelTurn({ sessionId })
			})
	)

	// #268 defect 2: a real Claude permission prompt (the SDK's own canUseTool
	// callback, invoked mid-turn when a tool needs approval) used to fold into
	// a generic SessionMetaUpdated event whose metadata nobody reads for
	// approvals -- ProjectionPendingApprovals.apply only reacts to a native
	// ApprovalRequested/InteractionReplied event, so projection_pending_approvals
	// never learned about a real permission request and the desktop panel had
	// nothing to render: the turn hung on an approval no one could see or
	// answer. Pins down that ClaudeAdapter publishes a typed ApprovalRequested
	// event (same shape the tracer's approval.request decider produces), and
	// that respondToPermission resolves the SDK's own canUseTool promise.
	Vitest.it.effect(
		"emits ApprovalRequested for a real permission prompt and respondToPermission resolves it",
		() =>
			Effect.gen(function*() {
				const inbound = yield* Queue.unbounded<Json, Done>()
				const interrupts = yield* Ref.make(0)
				const { adapter, events, canUseTool } = yield* openPromptedSession({
					createQuery: () => Effect.succeed(fakeHandle(inbound, interrupts))
				})
				const decisionFiber = yield* Effect.promise(() =>
					canUseTool("Edit", { file_path: "/tmp/acepe/a.txt" }, { toolUseID: "toolu_edit_1" })
				).pipe(Effect.forkChild({ startImmediately: true }))
				let approvalRequested: OrchestrationEvent | undefined
				for (let attempt = 0; attempt < 5 && approvalRequested === undefined; attempt++) {
					const next = yield* Queue.take(events)
					if (next.type === "SessionMetaUpdated") {
						const fact = decodeContractFact(next.metadata)
						if (Option.isSome(fact)) {
							Vitest.assert.notStrictEqual(fact.value.contractKind, "permission_request")
						}
					}
					if (next.type === "ApprovalRequested") {
						approvalRequested = next
					}
				}
				if (approvalRequested === undefined || approvalRequested.type !== "ApprovalRequested") {
					Vitest.assert.fail("expected an ApprovalRequested event for the permission prompt")
					return
				}
				Vitest.assert.strictEqual(approvalRequested.payload.sessionId, sessionId)
				const approvalRequestId = approvalRequested.payload.approvalRequestId
				yield* adapter.respondToPermission({
					sessionId,
					permissionId: approvalRequestId,
					decision: "allow"
				})
				const result = yield* Fiber.join(decisionFiber)
				Vitest.assert.strictEqual(result.behavior, "allow")
				yield* adapter.cancelTurn({ sessionId })
			})
	)

	Vitest.it.effect("cancelTurn interrupts the fake transport and emits TurnCancelled", () =>
		Effect.gen(function*() {
			const inbound = yield* Queue.unbounded<Json, Done>()
			const interrupts = yield* Ref.make(0)
			const { adapter, events } = yield* startTestSession({
				createQuery: () => Effect.succeed(fakeHandle(inbound, interrupts))
			})
			yield* Queue.take(events) // deferred_open
			yield* adapter.cancelTurn({ sessionId })
			const cancelled = yield* takeEventOfType(events, "TurnCancelled")
			Vitest.assert.strictEqual(cancelled.type, "TurnCancelled")
			Vitest.assert.strictEqual(yield* Ref.get(interrupts), 1)
		})
	)

	// Reproduces DEFECT A (BLOCKER): a follow-up message sent right after
	// cancelling a turn hung forever in production -- the turn stayed
	// "running", 0 tokens, the `claude` CLI subprocess alive but CPU-idle.
	// Root cause: cancelTurn used to interrupt() the SAME query and then just
	// remove the session, trusting the SDK to leave that query ready for more
	// prompts (its own docs say interrupt() "return[s] control to the
	// caller" on a query meant to keep accepting streamed input) -- but a
	// wedged interrupt() promise left the whole session, and the awaiting
	// caller, hung. cancelTurn now bounds interrupt() with a timeout and
	// unconditionally re-attaches a fresh query afterward (attachQuery), so
	// this must complete and the NEXT prompt must reach a NEW scripted
	// attempt, not the abandoned first one.
	Vitest.it.live("prompt -> cancel -> next prompt streams and completes on a fresh query", () =>
		Effect.gen(function*() {
			const sdk = yield* makeScriptedClaudeSdk()
			const { adapter, events } = yield* startTestSession({
				createQuery: sdk.createQuery
			})
			yield* Queue.take(events) // deferred_open

			yield* Stream.runCollect(
				adapter.sendPrompt({ sessionId, messageId, text: "First turn" })
			)
			const firstAttempts = yield* waitUntil(Ref.get(sdk.attemptsRef), (a) => a.length >= 1)
			Vitest.assert.strictEqual(firstAttempts.length, 1)

			yield* adapter.cancelTurn({ sessionId })
			// cancelTurn interrupts and closes the first attempt but does NOT
			// eagerly spawn a replacement -- a cancel with no follow-up must
			// not pay for a real subprocess nobody asked for. Only the first
			// attempt exists until the next sendPrompt actually needs one.
			const stillOneAttempt = yield* waitUntil(Ref.get(sdk.attemptsRef), (a) => a.length >= 1)
			Vitest.assert.strictEqual(stillOneAttempt.length, 1)
			Vitest.assert.isTrue(yield* Ref.get(stillOneAttempt[0]!.interrupted))
			Vitest.assert.isTrue(yield* Ref.get(stillOneAttempt[0]!.closed))

			// The next prompt must attach and reach a SECOND attempt -- the
			// session was never removed, so sendPrompt must still resolve.
			yield* Stream.runCollect(
				adapter.sendPrompt({
					sessionId,
					messageId: messageId2,
					text: "Reply with exactly: POSTCANCEL_42"
				})
			)
			const afterCancel = yield* waitUntil(Ref.get(sdk.attemptsRef), (a) => a.length >= 2)
			Vitest.assert.strictEqual(afterCancel.length, 2)
			const secondAttempt = afterCancel[1]!
			yield* Queue.offer(secondAttempt.inbound, {
				type: "stream_event",
				session_id: "sdk-session-2",
				event: {
					type: "content_block_delta",
					delta: { type: "text_delta", text: "POSTCANCEL_42" }
				}
			})

			let tokenEvent: OrchestrationEvent | undefined
			for (let attempt = 0; attempt < 10 && tokenEvent === undefined; attempt++) {
				const next = yield* Queue.take(events)
				if (next.type === "TokenAppended") {
					tokenEvent = next
				}
			}
			if (tokenEvent === undefined || tokenEvent.type !== "TokenAppended") {
				Vitest.assert.fail("expected a TokenAppended event from the post-cancel prompt")
				return
			}
			Vitest.assert.strictEqual(tokenEvent.payload.token, "POSTCANCEL_42")
			yield* adapter.cancelTurn({ sessionId }).pipe(Effect.ignore)
		})
	)

	// Reproduces DEFECT B (MAJOR): turns hang the same way WITHOUT a
	// preceding cancel -- the SDK stream simply stops emitting anything
	// mid-turn, no error, no completion. A configurable turn-inactivity
	// watchdog must notice (no stream item for N ms while a turn is open),
	// surface a typed failure (turn_error, which ClaudeAdapter already folds
	// into TurnCompleted -- see Facts.ts's TurnErrorFact) so the stuck
	// turn closes in the projection, and recover the session so the NEXT
	// prompt still works.
	Vitest.it.live(
		"a stalled turn is recovered by the inactivity watchdog and the next prompt still works",
		() =>
			Effect.gen(function*() {
				const sdk = yield* makeScriptedClaudeSdk()
				const { adapter, events } = yield* startTestSession({
					createQuery: sdk.createQuery,
					turnInactivityTimeout: Duration.millis(30),
					watchdogPollInterval: Duration.millis(10)
				})
				yield* Queue.take(events) // deferred_open

				yield* Stream.runCollect(
					adapter.sendPrompt({ sessionId, messageId, text: "This turn will stall" })
				)
				// The scripted SDK never offers anything into the first
				// attempt's inbound queue -- exactly a stalled turn: prompt
				// sent, zero stream activity, no completion.

				let completed: OrchestrationEvent | undefined
				for (let attempt = 0; attempt < 40 && completed === undefined; attempt++) {
					const next = yield* Queue.take(events)
					if (next.type === "TurnCompleted") {
						completed = next
					}
				}
				if (completed === undefined) {
					Vitest.assert.fail("expected the watchdog to close the stalled turn with TurnCompleted")
					return
				}

				const afterWatchdog = yield* waitUntil(Ref.get(sdk.attemptsRef), (a) => a.length >= 2)
				Vitest.assert.strictEqual(afterWatchdog.length, 2)
				Vitest.assert.isTrue(yield* Ref.get(afterWatchdog[0]!.closed))

				// The recovered session must still accept the next prompt.
				yield* Stream.runCollect(
					adapter.sendPrompt({
						sessionId,
						messageId: messageId2,
						text: "Reply with exactly: RECOVERED_7"
					})
				)
				const secondAttempt = afterWatchdog[1]!
				yield* Queue.offer(secondAttempt.inbound, {
					type: "stream_event",
					session_id: "sdk-session-2",
					event: {
						type: "content_block_delta",
						delta: { type: "text_delta", text: "RECOVERED_7" }
					}
				})

				let tokenEvent: OrchestrationEvent | undefined
				for (let attempt = 0; attempt < 10 && tokenEvent === undefined; attempt++) {
					const next = yield* Queue.take(events)
					if (next.type === "TokenAppended") {
						tokenEvent = next
					}
				}
				if (tokenEvent === undefined || tokenEvent.type !== "TokenAppended") {
					Vitest.assert.fail("expected a TokenAppended event from the post-recovery prompt")
					return
				}
				Vitest.assert.strictEqual(tokenEvent.payload.token, "RECOVERED_7")
				yield* adapter.cancelTurn({ sessionId }).pipe(Effect.ignore)
			})
	)

	// Reproduces DEFECT C (minor): a spawned `claude` subprocess survived app
	// quit -- nothing ever called the adapter's teardown path, so a session
	// that neither cancelled nor errored just kept its query (and the real SDK
	// process behind it) alive forever. `shutdown` must forcefully tear down
	// EVERY live session's query (interrupt, then close -- see teardownQuery)
	// regardless of whether a turn is even open, and must not depend on any
	// caller-provided timeout: ProviderBridge.ts is the one that bounds it
	// (shutdownAllAdapters), shutdown itself just needs to actually run.
	Vitest.it.live(
		"shutdown interrupts and closes every live session's query",
		() =>
			Effect.gen(function*() {
				const sdk = yield* makeScriptedClaudeSdk()
				const adapter = yield* makeClaudeAdapter({
					presence: Effect.succeed(claudePresence(true, true)),
					createQuery: sdk.createQuery
				})
				const sessionIdTwo = SessionId.make("session-2")

				const eventsOne = yield* Queue.unbounded<OrchestrationEvent, Done>()
				yield* adapter
					.startSession({ sessionId, projectId, workspaceRoot: "/tmp/acepe", envOverrides: {} })
					.pipe(
						Stream.runForEach((event) => Queue.offer(eventsOne, event).pipe(Effect.asVoid)),
						Effect.forkChild({ startImmediately: true })
					)
				yield* Queue.take(eventsOne) // deferred_open

				const eventsTwo = yield* Queue.unbounded<OrchestrationEvent, Done>()
				yield* adapter
					.startSession({
						sessionId: sessionIdTwo,
						projectId,
						workspaceRoot: "/tmp/acepe",
						envOverrides: {}
					})
					.pipe(
						Stream.runForEach((event) => Queue.offer(eventsTwo, event).pipe(Effect.asVoid)),
						Effect.forkChild({ startImmediately: true })
					)
				yield* Queue.take(eventsTwo) // deferred_open

				const beforeShutdown = yield* Ref.get(sdk.attemptsRef)
				Vitest.assert.strictEqual(beforeShutdown.length, 2, "both sessions must have attached a query")
				for (const attempt of beforeShutdown) {
					Vitest.assert.isFalse(yield* Ref.get(attempt.interrupted))
					Vitest.assert.isFalse(yield* Ref.get(attempt.closed))
				}

				yield* adapter.shutdown

				const allClosed = yield* waitUntil(
					Effect.forEach(beforeShutdown, (attempt) => Ref.get(attempt.closed)),
					(closedFlags) => closedFlags.every((closed) => closed)
				)
				Vitest.assert.isTrue(allClosed.every((closed) => closed), "shutdown must close every live query")
				for (const attempt of beforeShutdown) {
					Vitest.assert.isTrue(
						yield* Ref.get(attempt.interrupted),
						"shutdown must interrupt every live query before closing it"
					)
				}

				// No new attempt must have been spawned -- shutdown tears down what's
				// live, it must never itself start a fresh subprocess.
				const afterShutdown = yield* Ref.get(sdk.attemptsRef)
				Vitest.assert.strictEqual(afterShutdown.length, 2)
			})
	)

	// A pending permission blocks the SDK's own canUseTool promise on
	// decidePermission's Deferred, and that promise runs on a detached fiber
	// Effect.runPromise started (see bindCanUseTool) — nothing in
	// sessionScope can interrupt it. Every path that abandons the tool call
	// waiting on it must therefore resolve it explicitly, or the SDK waits
	// forever and the session wedges with a `claude` subprocess still alive.
	// The four tests below pin down the four such paths: cancel, shutdown,
	// the inactivity watchdog, and the query stream simply dying.
	Vitest.it.live("cancelTurn denies a permission the SDK is still blocked on", () =>
		Effect.gen(function*() {
			const inbound = yield* Queue.unbounded<Json, Done>()
			const interrupts = yield* Ref.make(0)
			const session = yield* withBlockedPermission({
				createQuery: () => Effect.succeed(fakeHandle(inbound, interrupts))
			})
			yield* session.adapter.cancelTurn({ sessionId })
			yield* assertAbandonedDenial(
				session.decisionFiber,
				"cancelTurn left the SDK's canUseTool promise pending forever"
			)
		})
	)

	// Resolving the deferred is only half of abandoning a permission. The
	// drain used to publish nothing, so projection_pending_approvals kept the
	// row: after a normal cancel the operator still saw a clickable approval
	// for a turn that was over, and clicking it appended a spurious
	// ProviderSessionFailed because respondToPermission found the pending map
	// empty. The drain now stamps the same ApprovalAnswered metadata an
	// answered approval writes.
	Vitest.it.live("cancelTurn clears the projected approval row it abandons", () =>
		Effect.gen(function*() {
			const inbound = yield* Queue.unbounded<Json, Done>()
			const interrupts = yield* Ref.make(0)
			const { adapter, events, canUseTool } = yield* openPromptedSession({
				createQuery: () => Effect.succeed(fakeHandle(inbound, interrupts))
			})
			const pending = yield* forkProjectedPermission(canUseTool, events)
			Vitest.assert.strictEqual(pending.length, 1)
			yield* adapter.cancelTurn({ sessionId })
			Vitest.assert.deepStrictEqual(yield* projectUntilCleared(events, pending), [])
		})
	)

	// The teardown window: the tool call was already running when the cancel
	// arrived, so the SDK can still reach canUseTool while interrupt() is in
	// flight. A drain that only runs BEFORE teardownQuery never sees that
	// permission, and the listener's own cleanup skips its drain because
	// cancelTurn already bumped the generation — so nothing resolves it and
	// the SDK waits forever, the very hang the drain exists to prevent.
	Vitest.it.live("denies a permission the SDK raises while the query is torn down", () =>
		Effect.gen(function*() {
			const inbound = yield* Queue.unbounded<Json, Done>()
			let raisedDuringTeardown: Promise<unknown> | undefined
			const { adapter } = yield* openPromptedSession({
				createQuery: (input) =>
					Effect.succeed({
						messages: Stream.fromQueue(inbound),
						interrupt: Effect.sync(() => {
							raisedDuringTeardown = input.canUseTool(
								"Edit",
								{ file_path: "/tmp/acepe/late.txt" },
								{ toolUseID: "toolu_during_teardown" }
							)
							// Long enough for the detached fiber behind that promise
							// to register its deferred before teardown finishes.
						}).pipe(Effect.andThen(Effect.sleep(Duration.millis(30)))),
						setPermissionMode: () => Effect.void,
						setModel: () => Effect.void,
						supportedModels: Effect.succeed(SCRIPTED_MODELS),
						close: Queue.end(inbound).pipe(Effect.asVoid)
					} satisfies ClaudeQueryHandle),
				cancelInterruptTimeout: Duration.millis(500)
			})
			yield* adapter.cancelTurn({ sessionId })
			const raised = raisedDuringTeardown
			if (raised === undefined) {
				Vitest.assert.fail("expected the teardown to raise a permission")
				return
			}
			const decision = yield* Effect.promise(() => raised).pipe(
				Effect.timeoutOption(ABANDONED_DECISION_TIMEOUT)
			)
			if (Option.isNone(decision)) {
				Vitest.assert.fail(
					"a permission raised during teardown was left pending forever"
				)
				return
			}
		})
	)

	// shutdown's OWN drain has to be what resolves this one, so the query
	// handle here closes every other route to the deferred: `close` leaves
	// the message stream open, so the listener fiber never ends and its own
	// cleanup drain never runs; `interrupt` blocks until this test releases
	// it, so both the drain AFTER the teardown and sessionScope's closing
	// are still in the future while the assertion runs. What is left is the
	// drain shutdown runs BEFORE tearing the query down — which is also the
	// ordering that matters in production, since a pending canUseTool is
	// exactly what wedges the SDK's own interrupt().
	Vitest.it.live("shutdown denies a permission before it tears the query down", () =>
		Effect.gen(function*() {
			const inbound = yield* Queue.unbounded<Json, Done>()
			const releaseInterrupt = yield* Deferred.make<void>()
			const session = yield* withBlockedPermission({
				createQuery: () =>
					Effect.succeed({
						messages: Stream.fromQueue(inbound),
						interrupt: Deferred.await(releaseInterrupt),
						setPermissionMode: () => Effect.void,
						setModel: () => Effect.void,
						supportedModels: Effect.succeed(SCRIPTED_MODELS),
						close: Effect.void
					} satisfies ClaudeQueryHandle),
				cancelInterruptTimeout: Duration.seconds(10)
			})
			const shutdownFiber = yield* session.adapter.shutdown.pipe(
				Effect.forkChild({ startImmediately: true })
			)
			yield* assertAbandonedDenial(
				session.decisionFiber,
				"shutdown left the SDK's canUseTool promise pending until it tore the query down"
			)
			yield* Deferred.succeed(releaseInterrupt, undefined)
			yield* Fiber.join(shutdownFiber)
		})
	)

	// A turn blocked on a permission is not stalled: it is waiting on a
	// human, and a human takes longer than turnInactivityTimeout. Counting
	// that wait as inactivity kills the turn out from under the operator —
	// the approval is auto-denied, the query is torn down and the tool never
	// runs — which is exactly what the live app did: ApprovalRequested, then
	// 60s later a recovered turn and no file written.
	Vitest.it.live("does not kill a turn that is waiting on a human permission", () =>
		Effect.gen(function*() {
			const sdk = yield* makeScriptedClaudeSdk()
			const session = yield* withBlockedPermission({
				createQuery: sdk.createQuery,
				turnInactivityTimeout: Duration.millis(30),
				watchdogPollInterval: Duration.millis(10)
			})
			// Ten poll intervals and ten inactivity timeouts' worth of wall
			// clock: if the watchdog treats the permission wait as a stall it
			// has fired many times over by now.
			yield* Effect.sleep(Duration.millis(300))
			const decision = yield* Fiber.join(session.decisionFiber).pipe(
				Effect.timeoutOption(Duration.millis(50))
			)
			if (Option.isSome(decision)) {
				return Vitest.assert.fail(
					`the watchdog answered a pending human permission by itself (${decision.value.behavior})`
				)
			}
			const attempts = yield* Ref.get(sdk.attemptsRef)
			Vitest.assert.strictEqual(
				attempts.length,
				1,
				"the watchdog tore down and re-attached the query the permission belonged to"
			)
		})
	)

	Vitest.it.live("the inactivity watchdog denies a permission the stalled turn was blocked on", () =>
		Effect.gen(function*() {
			const sdk = yield* makeScriptedClaudeSdk()
			// The scripted SDK never offers anything into the attempt's inbound
			// queue, so the turn stalls exactly as DEFECT B's test describes —
			// except this time a permission is in flight when the watchdog
			// tears the query down.
			const session = yield* withBlockedPermission({
				createQuery: sdk.createQuery,
				turnInactivityTimeout: Duration.millis(30),
				// A permission wait has its OWN, much larger bound (see
				// permissionWaitTimeout) so a human is never hurried by the
				// stall bound; shortened here so the safety valve — an
				// approval nobody answers must still release the query — is
				// testable in milliseconds.
				permissionWaitTimeout: Duration.millis(30),
				watchdogPollInterval: Duration.millis(10)
			})
			yield* assertAbandonedDenial(
				session.decisionFiber,
				"the watchdog left the SDK's canUseTool promise pending forever"
			)
			const afterWatchdog = yield* waitUntil(Ref.get(sdk.attemptsRef), (a) => a.length >= 2)
			Vitest.assert.strictEqual(afterWatchdog.length, 2)
		})
	)

	Vitest.it.live("a dead query stream denies a permission the SDK is still blocked on", () =>
		Effect.gen(function*() {
			const inbound = yield* Queue.unbounded<Json, Done>()
			const interrupts = yield* Ref.make(0)
			const session = yield* withBlockedPermission({
				createQuery: () => Effect.succeed(fakeHandle(inbound, interrupts))
			})
			// The query stream simply ends — the shape ProviderBridge turns
			// into ProviderSessionFailed, and the one path that drops the
			// session runtime for good (see attachQuery's own cleanup).
			yield* Queue.end(inbound)
			yield* assertAbandonedDenial(
				session.decisionFiber,
				"a dead query stream left the SDK's canUseTool promise pending forever"
			)
		})
	)

	// Claude's mode is the SDK's own permission mode, and it has to survive
	// the query being REPLACED: cancelTurn tears the query down and the next
	// sendPrompt attaches a fresh one, so a mode that only ever reached the
	// live query would silently revert to "default" on the very next turn.
	Vitest.it.live("carries a set mode onto the live query and onto its replacement", () =>
		Effect.gen(function*() {
			const sdk = yield* makeScriptedClaudeSdk()
			const { adapter } = yield* openPromptedSession({ createQuery: sdk.createQuery })
			yield* adapter.setMode({ sessionId, modeId: "plan" })
			const opened = yield* waitUntil(Ref.get(sdk.attemptsRef), (a) => a.length >= 1)
			const firstAttempt = opened[0]
			if (firstAttempt === undefined) {
				return Vitest.assert.fail("expected a first query attempt")
			}
			Vitest.assert.strictEqual(firstAttempt.permissionMode, "default")
			const liveRequests = yield* Ref.get(firstAttempt.modeRequests)
			Vitest.assert.deepStrictEqual(liveRequests, ["plan"])
			yield* adapter.cancelTurn({ sessionId })
			yield* Stream.runCollect(
				adapter.sendPrompt({ sessionId, messageId: messageId2, text: "and now?" })
			)
			const attempts = yield* waitUntil(Ref.get(sdk.attemptsRef), (a) => a.length >= 2)
			Vitest.assert.strictEqual(attempts[1]?.permissionMode, "plan")
		})
	)

	Vitest.it.live("fails a mode the Claude SDK has no permission mode for", () =>
		Effect.gen(function*() {
			const sdk = yield* makeScriptedClaudeSdk()
			const { adapter } = yield* openPromptedSession({ createQuery: sdk.createQuery })
			const error = yield* adapter.setMode({ sessionId, modeId: "read-only" }).pipe(Effect.flip)
			Vitest.assert.strictEqual(error.operation, "setMode")
		})
	)

	// The picker used to offer a constant. This is the fact that replaces it:
	// the adapter asks the provider what it can run, and publishes the
	// answer on the session's own event stream.
	Vitest.it.live("publishes the models its provider reports when a session opens", () =>
		Effect.gen(function*() {
			const sdk = yield* makeScriptedClaudeSdk()
			const { events } = yield* startTestSession({ createQuery: sdk.createQuery })
			const models = yield* takeSessionModels(events)
			Vitest.assert.deepStrictEqual(models, SCRIPTED_MODELS)
		})
	)

	// Same two halves the mode has, and for the same reason: a model that
	// only ever reached the live query would silently revert on the next
	// turn, because a cancel or a stall recovery builds a fresh query.
	Vitest.it.live("carries a set model onto the live query and onto its replacement", () =>
		Effect.gen(function*() {
			const sdk = yield* makeScriptedClaudeSdk()
			const { adapter } = yield* openPromptedSession({ createQuery: sdk.createQuery })
			yield* adapter.setModel({ sessionId, modelId: "claude-opus-5" })
			const opened = yield* waitUntil(Ref.get(sdk.attemptsRef), (a) => a.length >= 1)
			const firstAttempt = opened[0]
			if (firstAttempt === undefined) {
				return Vitest.assert.fail("expected a first query attempt")
			}
			Vitest.assert.isTrue(Option.isNone(firstAttempt.model))
			const liveRequests = yield* Ref.get(firstAttempt.modelRequests)
			Vitest.assert.deepStrictEqual(liveRequests, ["claude-opus-5"])
			yield* adapter.cancelTurn({ sessionId })
			yield* Stream.runCollect(
				adapter.sendPrompt({ sessionId, messageId: messageId2, text: "and now?" })
			)
			const attempts = yield* waitUntil(Ref.get(sdk.attemptsRef), (a) => a.length >= 2)
			Vitest.assert.deepStrictEqual(attempts[1]?.model, Option.some("claude-opus-5"))
		})
	)


	// A signed-out CLI answers the turn with its login notice and the query
	// stays unauthenticated until it is rebuilt: the fact must reach the
	// store as a canonical auth_required meta event, and the NEXT prompt
	// must attach a fresh query so a login completed in between actually
	// takes effect.
	Vitest.it.effect("publishes auth_required and reattaches the next prompt after a signed-out turn", () =>
		Effect.gen(function*() {
			const sdk = yield* makeScriptedClaudeSdk()
			const { adapter, events } = yield* startTestSession({ createQuery: sdk.createQuery })
			yield* Stream.runCollect(
				adapter.sendPrompt({ sessionId, messageId, text: "hello" })
			)
			const attemptsBefore = yield* waitUntil(Ref.get(sdk.attemptsRef), (a) => a.length >= 1)
			const first = attemptsBefore[0]
			if (first === undefined) {
				return Vitest.assert.fail("expected a first query attempt")
			}
			yield* Queue.offer(first.inbound, {
				type: "result",
				session_id: "sdk-session-auth",
				is_error: false,
				result: "Not logged in · Please run /login"
			})
			const seen: Array<string> = []
			let sawAuthRequired = false
			while (!sawAuthRequired) {
				const event = yield* Queue.take(events)
				seen.push(event.type)
				if (event.type === "SessionMetaUpdated") {
					const fact = decodeContractFact(event.metadata)
					if (Option.isSome(fact) && fact.value.contractKind === "auth_required") {
						sawAuthRequired = true
					}
				}
				if (seen.length > 20) {
					return Vitest.assert.fail(
						`expected an auth_required meta event, saw: ${seen.join(", ")}`
					)
				}
			}
			yield* Stream.runCollect(
				adapter.sendPrompt({ sessionId, messageId: messageId2, text: "after login" })
			)
			const attempts = yield* waitUntil(Ref.get(sdk.attemptsRef), (a) => a.length >= 2)
			Vitest.assert.strictEqual(attempts.length, 2)
		})
	)

	// ─── preconnection model catalog ──────────────────────────────────────

	// The probe must answer WITHOUT any session existing: it builds its own
	// short-lived query, reads the SDK's initialize-handshake catalog, and
	// closes that query. The composer's pre-start picker is fed from this.
	Vitest.it.effect("modelCatalog answers from a probe query and closes it", () =>
		Effect.gen(function*() {
			const inbound = yield* Queue.unbounded<Json, Done>()
			const interrupts = yield* Ref.make(0)
			const created = yield* Ref.make(0)
			const closed = yield* Ref.make(0)
			const adapter = yield* makeClaudeAdapter({
				presence: Effect.succeed(claudePresence(true, true)),
				createQuery: () =>
					Ref.update(created, (count) => count + 1).pipe(
						Effect.map(() => {
							const handle = fakeHandle(inbound, interrupts)
							return {
								...handle,
								close: Ref.update(closed, (count) => count + 1).pipe(
									Effect.flatMap(() => handle.close)
								)
							}
						})
					)
			})
			const catalog = yield* adapter.modelCatalog
			Vitest.assert.deepStrictEqual(
				catalog.map((model) => model.modelId),
				["claude-opus-5", "claude-sonnet-5"]
			)
			Vitest.assert.strictEqual(yield* Ref.get(created), 1)
			Vitest.assert.strictEqual(yield* Ref.get(closed), 1)
		})
	)

	Vitest.it.effect("modelCatalog serves the second call from cache without a new probe", () =>
		Effect.gen(function*() {
			const inbound = yield* Queue.unbounded<Json, Done>()
			const interrupts = yield* Ref.make(0)
			const created = yield* Ref.make(0)
			const adapter = yield* makeClaudeAdapter({
				presence: Effect.succeed(claudePresence(true, true)),
				createQuery: () =>
					Ref.update(created, (count) => count + 1).pipe(
						Effect.map(() => fakeHandle(inbound, interrupts))
					)
			})
			yield* adapter.modelCatalog
			const again = yield* adapter.modelCatalog
			Vitest.assert.deepStrictEqual(
				again.map((model) => model.modelId),
				["claude-opus-5", "claude-sonnet-5"]
			)
			Vitest.assert.strictEqual(yield* Ref.get(created), 1)
		})
	)

	// A probe that fails must not poison the cache: the next ask probes again.
	Vitest.it.effect("modelCatalog retries after a failed probe", () =>
		Effect.gen(function*() {
			const inbound = yield* Queue.unbounded<Json, Done>()
			const interrupts = yield* Ref.make(0)
			const created = yield* Ref.make(0)
			const adapter = yield* makeClaudeAdapter({
				presence: Effect.succeed(claudePresence(true, true)),
				createQuery: () =>
					Ref.updateAndGet(created, (count) => count + 1).pipe(
						Effect.flatMap((attempt) =>
							attempt === 1
								? Effect.fail(
									adapterError("startSession", "scripted probe failure")
								)
								: Effect.succeed(fakeHandle(inbound, interrupts))
						)
					)
			})
			const first = yield* Effect.result(adapter.modelCatalog)
			Vitest.assert.isTrue(Result.isFailure(first))
			const second = yield* adapter.modelCatalog
			Vitest.assert.deepStrictEqual(
				second.map((model) => model.modelId),
				["claude-opus-5", "claude-sonnet-5"]
			)
		})
	)

})
