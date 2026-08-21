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
	makeOpenCodeAdapter,
	type OpenCodeCatalogCommand,
	type OpenCodeModelCatalog,
	type OpenCodeTransport
} from "./OpenCodeAdapter.ts"
import {
	decodeContractFact,
	type OpenCodePermissionReply,
	type OpenCodePromptBody,
	type OpenCodeSessionRecord
} from "./OpenCodeMap.ts"
import { OPENCODE_PROVIDER_ID, openCodePresence } from "./OpenCodeProvider.ts"

type Json = typeof Schema.Json.Type

const sessionId = SessionId.make("session-1")
const projectId = ProjectId.make("project-1")
const messageId = MessageId.make("message-user")
const workspaceRoot = "/tmp/acepe"
const providerSessionId = "ses_test_123"

type TransportCalls = {
	readonly prompts: ReadonlyArray<{
		readonly providerSessionId: string
		readonly body: OpenCodePromptBody
	}>
	readonly aborted: ReadonlyArray<string>
	readonly permissions: ReadonlyArray<{
		readonly requestId: string
		readonly reply: OpenCodePermissionReply
	}>
	readonly closed: number
}

const emptyCalls: TransportCalls = {
	prompts: Arr.empty(),
	aborted: Arr.empty(),
	permissions: Arr.empty(),
	closed: 0
}

const matchingSession: OpenCodeSessionRecord = {
	id: providerSessionId,
	directory: workspaceRoot,
	projectID: "prj_test"
}

const selectedCatalog: OpenCodeModelCatalog = {
	models: [
		{
			modelId: "openrouter/anthropic/claude-sonnet-4.6",
			name: "Sonnet"
		}
	],
	currentModelId: Option.some("openrouter/anthropic/claude-sonnet-4.6")
}

const emptyCatalog: OpenCodeModelCatalog = {
	models: Arr.empty(),
	currentModelId: Option.none()
}

const commands: ReadonlyArray<OpenCodeCatalogCommand> = [
	{
		name: "init",
		description: "init"
	}
]

const fakeTransport = (
	inbound: Queue.Queue<Json, Done>,
	calls: Ref.Ref<TransportCalls>,
	created: OpenCodeSessionRecord,
	catalog: OpenCodeModelCatalog
): OpenCodeTransport => ({
	events: Stream.fromQueue(inbound),
	createSession: Effect.succeed(created),
	listModels: Effect.succeed(catalog),
	listCommands: Effect.succeed(commands),
	sendPrompt: (id, body) =>
		Ref.update(calls, (current) => ({
			prompts: Arr.append(current.prompts, {
				providerSessionId: id,
				body
			}),
			aborted: current.aborted,
			permissions: current.permissions,
			closed: current.closed
		})).pipe(Effect.asVoid),
	abort: (id) =>
		Ref.update(calls, (current) => ({
			prompts: current.prompts,
			aborted: Arr.append(current.aborted, id),
			permissions: current.permissions,
			closed: current.closed
		})).pipe(Effect.asVoid),
	replyPermission: (requestId, reply) =>
		Ref.update(calls, (current) => ({
			prompts: current.prompts,
			aborted: current.aborted,
			permissions: Arr.append(current.permissions, {
				requestId,
				reply
			}),
			closed: current.closed
		})).pipe(Effect.asVoid),
	replyQuestion: () => Effect.void,
	close: Queue.end(inbound).pipe(
		Effect.flatMap(() =>
			Ref.update(calls, (current) => ({
				prompts: current.prompts,
				aborted: current.aborted,
				permissions: current.permissions,
				closed: current.closed + 1
			}))
		),
		Effect.asVoid
	)
})

const startAdapter = Effect.fn("OpenCodeAdapter.test.startAdapter")(function*(
	created: OpenCodeSessionRecord,
	catalog: OpenCodeModelCatalog
) {
	const inbound = yield* Queue.unbounded<Json, Done>()
	const calls = yield* Ref.make(emptyCalls)
	const adapter = yield* makeOpenCodeAdapter({
		presence: Effect.succeed(openCodePresence(true, true)),
		createTransport: () => Effect.succeed(fakeTransport(inbound, calls, created, catalog))
	})
	const events = yield* Queue.unbounded<OrchestrationEvent, Done>()
	yield* adapter
		.startSession({
			sessionId,
			projectId,
			workspaceRoot
		})
		.pipe(
			Stream.runForEach((event) => Queue.offer(events, event).pipe(Effect.asVoid)),
			Effect.forkChild({ startImmediately: true })
		)
	return {
		adapter,
		inbound,
		calls,
		events
	}
})

Vitest.describe("OpenCodeAdapter", () => {
	Vitest.it.effect("emits provider_session over native HTTP, not ACP initialize", () =>
		Effect.gen(function*() {
			const started = yield* startAdapter(matchingSession, selectedCatalog)
			const opened = yield* Queue.take(started.events)
			Vitest.assert.strictEqual(opened.type, "SessionMetaUpdated")
			const fact = decodeContractFact(opened.metadata)
			Vitest.assert.isTrue(Option.isSome(fact))
			if (Option.isSome(fact)) {
				Vitest.assert.strictEqual(fact.value.contractKind, "provider_session")
				if (fact.value.contractKind === "provider_session") {
					Vitest.assert.strictEqual(fact.value.providerSessionId, providerSessionId)
				}
			}
			const catalogEvent = yield* Queue.take(started.events)
			Vitest.assert.strictEqual(catalogEvent.type, "SessionMetaUpdated")
			const catalogFact = decodeContractFact(catalogEvent.metadata)
			Vitest.assert.isTrue(Option.isSome(catalogFact))
			if (Option.isSome(catalogFact)) {
				Vitest.assert.strictEqual(catalogFact.value.contractKind, "session_catalog")
			}
			Vitest.assert.strictEqual(started.adapter.providerId, OPENCODE_PROVIDER_ID)
			yield* started.adapter.cancelTurn({ sessionId })
		})
	)

	Vitest.it.effect("sendPrompt emits MessageSent and posts prompt_async body", () =>
		Effect.gen(function*() {
			const started = yield* startAdapter(matchingSession, selectedCatalog)
			yield* Queue.take(started.events)
			yield* Queue.take(started.events)
			const sent = yield* Stream.runCollect(
				started.adapter.sendPrompt({
					sessionId,
					messageId,
					text: "Hello OpenCode"
				})
			)
			Vitest.assert.strictEqual(sent[0]?.type, "MessageSent")
			Vitest.assert.strictEqual(sent[0]?.payload.text, "Hello OpenCode")
			const calls = yield* Ref.get(started.calls)
			Vitest.assert.strictEqual(calls.prompts.length, 1)
			Vitest.assert.strictEqual(calls.prompts[0]?.providerSessionId, providerSessionId)
			Vitest.assert.strictEqual(calls.prompts[0]?.body.directory, workspaceRoot)
			Vitest.assert.strictEqual(calls.prompts[0]?.body.agent, "build")
			Vitest.assert.strictEqual(calls.prompts[0]?.body.model.providerID, "openrouter")
			Vitest.assert.strictEqual(
				calls.prompts[0]?.body.model.modelID,
				"anthropic/claude-sonnet-4.6"
			)
			Vitest.assert.strictEqual(calls.prompts[0]?.body.parts[0]?.type, "text")
			Vitest.assert.strictEqual(calls.prompts[0]?.body.parts[0]?.text, "Hello OpenCode")
			yield* started.adapter.cancelTurn({ sessionId })
		})
	)

	Vitest.it.effect("streams TokenAppended from fake OpenCode SSE text", () =>
		Effect.gen(function*() {
			const started = yield* startAdapter(matchingSession, selectedCatalog)
			yield* Queue.take(started.events)
			yield* Queue.take(started.events)
			yield* Stream.runCollect(
				started.adapter.sendPrompt({
					sessionId,
					messageId,
					text: "Hi"
				})
			)
			yield* Queue.offer(started.inbound, {
				type: "message.part.updated",
				properties: {
					part: {
						id: "prt_123",
						sessionID: providerSessionId,
						messageID: "msg_456",
						type: "text",
						text: "Hello"
					},
					delta: "Hello"
				}
			})
			const first = yield* Queue.take(started.events)
			const tokenEvent = first.type === "TokenAppended" ? first : yield* Queue.take(started.events)
			Vitest.assert.strictEqual(tokenEvent.type, "TokenAppended")
			if (tokenEvent.type === "TokenAppended") {
				Vitest.assert.strictEqual(tokenEvent.payload.token, "Hello")
				Vitest.assert.strictEqual(
					tokenEvent.payload.messageId,
					tracerAssistantMessageId(messageId)
				)
			}
			yield* started.adapter.cancelTurn({ sessionId })
		})
	)

	Vitest.it.effect("cancelTurn aborts the OpenCode session and emits TurnCancelled", () =>
		Effect.gen(function*() {
			const started = yield* startAdapter(matchingSession, selectedCatalog)
			yield* Queue.take(started.events)
			yield* Queue.take(started.events)
			yield* started.adapter.cancelTurn({ sessionId })
			const cancelled = yield* Queue.take(started.events)
			Vitest.assert.strictEqual(cancelled.type, "TurnCancelled")
			const calls = yield* Ref.get(started.calls)
			Vitest.assert.deepStrictEqual(calls.aborted, [providerSessionId])
		})
	)

	Vitest.it.effect("rejects a session whose directory does not match the workspace", () =>
		Effect.gen(function*() {
			const inbound = yield* Queue.unbounded<Json, Done>()
			const calls = yield* Ref.make(emptyCalls)
			const adapter = yield* makeOpenCodeAdapter({
				presence: Effect.succeed(openCodePresence(true, true)),
				createTransport: () =>
					Effect.succeed(
						fakeTransport(
							inbound,
							calls,
							{
								id: providerSessionId,
								directory: "/tmp/other-project",
								projectID: "prj_test"
							},
							selectedCatalog
						)
					)
			})
			const error = yield* adapter
				.startSession({
					sessionId,
					projectId,
					workspaceRoot
				})
				.pipe(Stream.runCollect, Effect.flip)
			Vitest.assert.strictEqual(error._tag, "ProviderAdapterError")
			Vitest.assert.strictEqual(error.operation, "startSession")
			Vitest.assert.strictEqual(
				error.detail,
				`OpenCode session binding mismatch: expected directory ${workspaceRoot}, got /tmp/other-project`
			)
		})
	)

	Vitest.it.effect("rejects sendPrompt when no model is selected", () =>
		Effect.gen(function*() {
			const started = yield* startAdapter(matchingSession, emptyCatalog)
			yield* Queue.take(started.events)
			yield* Queue.take(started.events)
			const error = yield* started.adapter
				.sendPrompt({
					sessionId,
					messageId,
					text: "Hello"
				})
				.pipe(Stream.runCollect, Effect.flip)
			Vitest.assert.strictEqual(error._tag, "ProviderAdapterError")
			Vitest.assert.strictEqual(error.operation, "sendPrompt")
			Vitest.assert.strictEqual(
				error.detail,
				"No model selected. A model must be set before sending a prompt."
			)
			yield* started.adapter.cancelTurn({ sessionId })
		})
	)

	Vitest.it.effect("maps permission.asked and replies with a safe request id", () =>
		Effect.gen(function*() {
			const started = yield* startAdapter(matchingSession, selectedCatalog)
			yield* Queue.take(started.events)
			yield* Queue.take(started.events)
			yield* Queue.offer(started.inbound, {
				type: "permission.asked",
				properties: {
					id: "perm_req_abc123",
					sessionID: providerSessionId,
					permission: "Read",
					patterns: ["*.txt"],
					metadata: {},
					always: []
				}
			})
			const permissionEvent = yield* Queue.take(started.events)
			Vitest.assert.strictEqual(permissionEvent.type, "SessionMetaUpdated")
			const fact = decodeContractFact(permissionEvent.metadata)
			Vitest.assert.isTrue(Option.isSome(fact))
			if (Option.isSome(fact) && fact.value.contractKind === "permission_request") {
				Vitest.assert.strictEqual(fact.value.id, "perm_req_abc123")
			}
			yield* started.adapter.respondToPermission({
				sessionId,
				permissionId: "perm_req_abc123",
				reply: "once"
			})
			const calls = yield* Ref.get(started.calls)
			Vitest.assert.deepStrictEqual(calls.permissions, [
				{
					requestId: "perm_req_abc123",
					reply: "once"
				}
			])
			const unsafe = yield* started.adapter
				.respondToPermission({
					sessionId,
					permissionId: "../etc/passwd",
					reply: "reject"
				})
				.pipe(Effect.flip)
			Vitest.assert.strictEqual(unsafe._tag, "ProviderAdapterError")
			yield* started.adapter.cancelTurn({ sessionId })
		})
	)
})
