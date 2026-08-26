import {
	type OrchestrationEvent,
	MessageId,
	ProjectId,
	SessionId,
	tracerAssistantMessageId
} from "@acepe/contracts"
import * as Vitest from "@effect/vitest"
import type { Done } from "effect/Cause"
import * as Duration from "effect/Duration"
import * as Effect from "effect/Effect"
import * as Option from "effect/Option"
import * as Queue from "effect/Queue"
import * as Ref from "effect/Ref"
import * as Schema from "effect/Schema"
import * as Stream from "effect/Stream"
import {
	buildClaudeQueryOptions,
	makeClaudeAdapter,
	type ClaudeQueryHandle,
	type ClaudeQueryInput
} from "./ClaudeAdapter.ts"
import { claudePresence } from "./ClaudeProvider.ts"
import { decodeContractFact } from "./ClaudeSdkMap.ts"

type Json = typeof Schema.Json.Type

const sessionId = SessionId.make("session-1")
const projectId = ProjectId.make("project-1")
const messageId = MessageId.make("message-user")
const messageId2 = MessageId.make("message-user-2")

const fakeHandle = (
	inbound: Queue.Queue<Json, Done>,
	interrupts: Ref.Ref<number>
): ClaudeQueryHandle => ({
	messages: Stream.fromQueue(inbound),
	interrupt: Ref.update(interrupts, (count) => count + 1).pipe(Effect.asVoid),
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
}

const makeScriptedClaudeSdk = Effect.fn("makeScriptedClaudeSdk")(function*() {
	const attemptsRef = yield* Ref.make<ReadonlyArray<ScriptedAttempt>>([])
	const createQuery = (input: ClaudeQueryInput) =>
		Effect.gen(function*() {
			const inbound = yield* Queue.unbounded<Json, Done>()
			const interrupted = yield* Ref.make(false)
			const closed = yield* Ref.make(false)
			const attempt: ScriptedAttempt = { inbound, interrupted, closed, resume: input.resume }
			yield* Ref.update(attemptsRef, (current) => [...current, attempt])
			return {
				messages: Stream.fromQueue(inbound),
				interrupt: Ref.set(interrupted, true).pipe(Effect.asVoid),
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

	// Reproduces the live bug: a real Claude turn's reply fully lands (the SDK
	// stream delivers a `result` message once Claude finishes replying) but
	// nothing closed projection_turns for it — no TurnCompleted event ever
	// appended, so the turn stayed "running" forever. ClaudeSdkMap.mapSdkMessage
	// already turns the SDK's `result` message into a `turn_complete` fact;
	// this pins down that ClaudeAdapter publishes that fact as a TurnCompleted
	// contract event instead of folding it into a generic SessionMetaUpdated.
	Vitest.it.effect("emits TurnCompleted when the SDK stream delivers a result message", () =>
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
					text: "Reply with exactly: TURN_42"
				})
			)
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
	// ProjectionSessionActivities.ts has no case for. ClaudeSdkMap.mapSdkMessage
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
				yield* Queue.take(events) // deferred_open
				yield* Stream.runCollect(
					adapter.sendPrompt({
						sessionId,
						messageId,
						text: "Read package.json"
					})
				)
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
			const adapter = yield* makeClaudeAdapter({
				presence: Effect.succeed(claudePresence(true, true)),
				createQuery: sdk.createQuery,
				cancelInterruptTimeout: Duration.millis(50)
			})
			const events = yield* Queue.unbounded<OrchestrationEvent, Done>()
			yield* adapter
				.startSession({ sessionId, projectId, workspaceRoot: "/tmp/acepe" })
				.pipe(
					Stream.runForEach((event) => Queue.offer(events, event).pipe(Effect.asVoid)),
					Effect.forkChild({ startImmediately: true })
				)
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
	// into TurnCompleted -- see ClaudeSdkMap.ts's TurnErrorFact) so the stuck
	// turn closes in the projection, and recover the session so the NEXT
	// prompt still works.
	Vitest.it.live(
		"a stalled turn is recovered by the inactivity watchdog and the next prompt still works",
		() =>
			Effect.gen(function*() {
				const sdk = yield* makeScriptedClaudeSdk()
				const adapter = yield* makeClaudeAdapter({
					presence: Effect.succeed(claudePresence(true, true)),
					createQuery: sdk.createQuery,
					turnInactivityTimeout: Duration.millis(30),
					watchdogPollInterval: Duration.millis(10)
				})
				const events = yield* Queue.unbounded<OrchestrationEvent, Done>()
				yield* adapter
					.startSession({ sessionId, projectId, workspaceRoot: "/tmp/acepe" })
					.pipe(
						Stream.runForEach((event) => Queue.offer(events, event).pipe(Effect.asVoid)),
						Effect.forkChild({ startImmediately: true })
					)
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
					.startSession({ sessionId, projectId, workspaceRoot: "/tmp/acepe" })
					.pipe(
						Stream.runForEach((event) => Queue.offer(eventsOne, event).pipe(Effect.asVoid)),
						Effect.forkChild({ startImmediately: true })
					)
				yield* Queue.take(eventsOne) // deferred_open

				const eventsTwo = yield* Queue.unbounded<OrchestrationEvent, Done>()
				yield* adapter
					.startSession({ sessionId: sessionIdTwo, projectId, workspaceRoot: "/tmp/acepe" })
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

	// These pin down the isolation fix's actual mechanism: the SDK's query()
	// options constructed for a live session must exclude the operator's
	// personal ~/.claude config while keeping the target repo's own project
	// settings — see buildClaudeQueryOptions' doc comment in ClaudeAdapter.ts
	// for the empirical evidence behind these exact values.
	Vitest.describe("buildClaudeQueryOptions", () => {
		const fakeCanUseTool = (() =>
			Promise.resolve({ behavior: "deny" as const, message: "unused in these tests" }))

		Vitest.it("excludes the operator's 'user' setting source, keeping 'project' and 'local'", () => {
			const options = buildClaudeQueryOptions(
				{ cwd: "/workspace/repo", canUseTool: fakeCanUseTool },
				{ pathToClaudeCodeExecutable: Option.none(), mcpServers: {} }
			)
			Vitest.assert.deepStrictEqual(options.settingSources, ["project", "local"])
		})

		Vitest.it("sets strictMcpConfig so operator MCP servers are never inherited", () => {
			const options = buildClaudeQueryOptions(
				{ cwd: "/workspace/repo", canUseTool: fakeCanUseTool },
				{ pathToClaudeCodeExecutable: Option.none(), mcpServers: {} }
			)
			Vitest.assert.strictEqual(options.strictMcpConfig, true)
		})

		Vitest.it("threads through Acepe's own mcpServers (not the operator's)", () => {
			const appConfiguredServers = {
				"acepe-tool": { command: "node", args: ["./acepe-mcp.js"] }
			}
			const options = buildClaudeQueryOptions(
				{ cwd: "/workspace/repo", canUseTool: fakeCanUseTool },
				{ pathToClaudeCodeExecutable: Option.none(), mcpServers: appConfiguredServers }
			)
			Vitest.assert.deepStrictEqual(options.mcpServers, appConfiguredServers)
		})

		Vitest.it("omits pathToClaudeCodeExecutable when none is resolved", () => {
			const options = buildClaudeQueryOptions(
				{ cwd: "/workspace/repo", canUseTool: fakeCanUseTool },
				{ pathToClaudeCodeExecutable: Option.none(), mcpServers: {} }
			)
			Vitest.assert.isUndefined(options.pathToClaudeCodeExecutable)
		})

		Vitest.it("includes pathToClaudeCodeExecutable when resolved", () => {
			const options = buildClaudeQueryOptions(
				{ cwd: "/workspace/repo", canUseTool: fakeCanUseTool },
				{ pathToClaudeCodeExecutable: Option.some("/usr/local/bin/claude"), mcpServers: {} }
			)
			Vitest.assert.strictEqual(options.pathToClaudeCodeExecutable, "/usr/local/bin/claude")
		})

		Vitest.it("keeps cwd and partial-message streaming", () => {
			const options = buildClaudeQueryOptions(
				{ cwd: "/workspace/repo", canUseTool: fakeCanUseTool },
				{ pathToClaudeCodeExecutable: Option.none(), mcpServers: {} }
			)
			Vitest.assert.strictEqual(options.cwd, "/workspace/repo")
			Vitest.assert.strictEqual(options.includePartialMessages, true)
		})
	})
})
