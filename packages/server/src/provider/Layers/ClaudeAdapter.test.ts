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
import { buildClaudeQueryOptions, makeClaudeAdapter, type ClaudeQueryHandle } from "./ClaudeAdapter.ts"
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
