import {
	type ApprovalRequestedEvent,
	type OrchestrationEvent,
	type ToolCallObservedEvent,
	MessageId,
	ProjectId,
	SessionId,
	tracerAssistantMessageId
} from "@acepe/contracts"
import * as BunFileSystem from "@effect/platform-bun/BunFileSystem"
import * as BunPath from "@effect/platform-bun/BunPath"
import * as Vitest from "@effect/vitest"
import * as Arr from "effect/Array"
import type { Done } from "effect/Cause"
import * as Duration from "effect/Duration"
import * as Effect from "effect/Effect"
import * as Fiber from "effect/Fiber"
import * as FileSystem from "effect/FileSystem"
import * as Layer from "effect/Layer"
import * as Option from "effect/Option"
import * as Path from "effect/Path"
import * as Queue from "effect/Queue"
import * as Ref from "effect/Ref"
import * as Stream from "effect/Stream"
import * as Str from "effect/String"
import {
	evolveProjectedPendingApprovals,
	type ProjectedPendingApproval
} from "../../../persistence/Services/ProjectionPendingApprovals.ts"
import { EMPTY_JSON_OBJECT, type Json } from "../Json.ts"
import { decodeSessionModelsFact } from "../SessionModelsFact.ts"
import {
	GROK_ACP_PROTOCOL_VERSION,
	GROK_ACP_SDK_MODULE,
	makeGrokAdapter
} from "./Adapter.ts"
import { decodeContractFact } from "./Codec.ts"
import type {
	GrokAcpHandle,
	GrokConnectInput,
	GrokLaunchConfig,
	GrokStopReason
} from "./Process.ts"
import {
	grokAuthenticateParams,
	grokPresence,
	missingGrokBinaryError,
	type GrokAuthenticateParams
} from "./Provider.ts"

const FORBIDDEN_ACP_ENTRY = "experimental/v2"
const STABLE_ACP_ENTRY = "@agentclientprotocol/sdk"
const STABLE_ACP_TRANSPORT = "ndJsonStream"

const sessionId = SessionId.make("session-1")
const projectId = ProjectId.make("project-1")
const messageId = MessageId.make("message-user")
const registryLaunch: GrokLaunchConfig = {
	command: "/usr/local/bin/grok",
	args: ["agent", "stdio"]
}

const Platform = Layer.mergeAll(BunFileSystem.layer, BunPath.layer)

const folderSources = Effect.gen(function*() {
	const path = yield* Path.Path
	const fs = yield* FileSystem.FileSystem
	const here = yield* path.fromFileUrl(new URL(import.meta.url))
	const folder = path.dirname(here)
	const guard = path.basename(here)
	const names = yield* fs.readDirectory(folder)
	const scanned = Arr.filter(names, (name) => Str.endsWith(".ts")(name) && name !== guard)
	return yield* Effect.forEach(scanned, (name) =>
		fs.readFileString(path.join(folder, name)).pipe(Effect.map((source) => ({ name, source })))
	)
})

type HandshakeCall =
	| { readonly method: "initialize" }
	| { readonly method: "authenticate"; readonly params: GrokAuthenticateParams }
	| { readonly method: "newSession"; readonly cwd: string }

const recordCall = (handshake: Ref.Ref<ReadonlyArray<HandshakeCall>>, call: HandshakeCall) =>
	Ref.update(handshake, (current) => Arr.append(current, call))

const grokInitializeWithModels: Json = {
	protocolVersion: 1,
	_meta: {
		modelState: {
			currentModelId: "grok-4.6",
			availableModels: [
				{
					modelId: "grok-4.6",
					name: "Grok 4.6",
					description: "SpaceXAI's latest frontier model"
				},
				{
					modelId: "grok-4.5",
					name: "Grok 4.5"
				}
			]
		}
	}
}

const fakeHandle = (
	inbound: Queue.Queue<Json, Done>,
	cancels: Ref.Ref<number>,
	cwds: Ref.Ref<ReadonlyArray<string>>,
	handshake: Ref.Ref<ReadonlyArray<HandshakeCall>>,
	initializeResult: Json = EMPTY_JSON_OBJECT
): GrokAcpHandle => ({
	initialize: recordCall(handshake, { method: "initialize" }).pipe(Effect.as(initializeResult)),
	authenticate: (params: GrokAuthenticateParams) =>
		recordCall(handshake, { method: "authenticate", params }),
	newSession: (cwd: string) =>
		recordCall(handshake, { method: "newSession", cwd }).pipe(
			Effect.flatMap(() => Ref.update(cwds, (current) => Arr.append(current, cwd))),
			Effect.as("acp-session-1")
		),
	prompt: () => Effect.succeed(Option.none()),
	cancel: () => Ref.update(cancels, (count) => count + 1).pipe(Effect.asVoid),
	setMode: () => Effect.void,
	setModel: () => Effect.void,
	close: Queue.end(inbound).pipe(Effect.asVoid)
})

// fakeHandle whose prompt settles with a stop reason, the way a real
// grok answers session/prompt once the turn is over.
const stoppingHandle = (
	inbound: Queue.Queue<Json, Done>,
	cancels: Ref.Ref<number>,
	cwds: Ref.Ref<ReadonlyArray<string>>,
	stopReason: GrokStopReason
): GrokAcpHandle => ({
	initialize: Effect.succeed(EMPTY_JSON_OBJECT),
	authenticate: () => Effect.void,
	newSession: (cwd: string) =>
		Ref.update(cwds, (current) => Arr.append(current, cwd)).pipe(
			Effect.as("acp-session-1")
		),
	prompt: () => Effect.succeed(Option.some(stopReason)),
	cancel: () => Ref.update(cancels, (count) => count + 1).pipe(Effect.asVoid),
	setMode: () => Effect.void,
	setModel: () => Effect.void,
	close: Queue.end(inbound).pipe(Effect.asVoid)
})

// fakeHandle with its ACP session/set_mode request recorded instead of
// ignored, for the one test that asserts the mode actually leaves the
// adapter over the wire.
const modeRecordingHandle = (
	inbound: Queue.Queue<Json, Done>,
	cancels: Ref.Ref<number>,
	cwds: Ref.Ref<ReadonlyArray<string>>,
	modes: Ref.Ref<ReadonlyArray<{ readonly providerSessionId: string; readonly modeId: string }>>
): GrokAcpHandle => ({
	initialize: Effect.succeed(EMPTY_JSON_OBJECT),
	authenticate: () => Effect.void,
	newSession: (cwd: string) =>
		Ref.update(cwds, (current) => Arr.append(current, cwd)).pipe(
			Effect.as("acp-session-1")
		),
	prompt: () => Effect.succeed(Option.none()),
	cancel: () => Ref.update(cancels, (count) => count + 1).pipe(Effect.asVoid),
	setMode: (providerSessionId: string, modeId: string) =>
		Ref.update(modes, (current) => Arr.append(current, { providerSessionId, modeId })).pipe(
			Effect.asVoid
		),
	setModel: () => Effect.void,
	close: Queue.end(inbound).pipe(Effect.asVoid)
})

const modelRecordingHandle = (
	inbound: Queue.Queue<Json, Done>,
	cancels: Ref.Ref<number>,
	cwds: Ref.Ref<ReadonlyArray<string>>,
	models: Ref.Ref<
		ReadonlyArray<{ readonly providerSessionId: string; readonly modelId: string }>
	>
): GrokAcpHandle => ({
	initialize: Effect.succeed(EMPTY_JSON_OBJECT),
	authenticate: () => Effect.void,
	newSession: (cwd: string) =>
		Ref.update(cwds, (current) => Arr.append(current, cwd)).pipe(Effect.as("acp-session-1")),
	prompt: () => Effect.succeed(Option.none()),
	cancel: () => Ref.update(cancels, (count) => count + 1).pipe(Effect.asVoid),
	setMode: () => Effect.void,
	setModel: (providerSessionId: string, modelId: string) =>
		Ref.update(models, (current) => Arr.append(current, { providerSessionId, modelId })).pipe(
			Effect.asVoid
		),
	close: Queue.end(inbound).pipe(Effect.asVoid)
})

const acpPermissionRequest = (toolCallId: string): Json => ({
	sessionId: "acp-session-1",
	toolCall: {
		toolCallId,
		title: "Run tests",
		kind: "execute",
		status: "pending"
	},
	options: [
		{ optionId: "allow-once", name: "Allow once", kind: "allow_once" },
		{ optionId: "reject", name: "Reject", kind: "reject_once" }
	]
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

// Same guard for the tool-call path: ProjectionSessionActivities only knows
// how to read a ToolCallObserved event.
const nextToolCallObserved = Effect.fn("nextToolCallObserved")(function*(
	events: Queue.Queue<OrchestrationEvent, Done>
) {
	let found: ToolCallObservedEvent | undefined
	for (let attempt = 0; attempt < 5 && found === undefined; attempt++) {
		const next = yield* Queue.take(events)
		if (next.type === "SessionMetaUpdated") {
			const fact = decodeContractFact(next.metadata)
			if (Option.isSome(fact)) {
				Vitest.assert.notStrictEqual(fact.value.contractKind, "tool_call")
				Vitest.assert.notStrictEqual(fact.value.contractKind, "tool_call_update")
			}
		}
		if (next.type === "ToolCallObserved") {
			found = next
		}
	}
	return found
})

// Same guard for the turn-end path: ProjectionTurns only closes a row on a
// TurnCompleted event.
const nextTurnCompleted = Effect.fn("nextTurnCompleted")(function*(
	events: Queue.Queue<OrchestrationEvent, Done>
) {
	for (let attempt = 0; attempt < 5; attempt++) {
		const next = yield* Queue.take(events)
		if (next.type === "SessionMetaUpdated") {
			const fact = decodeContractFact(next.metadata)
			if (Option.isSome(fact)) {
				Vitest.assert.notStrictEqual(fact.value.contractKind, "turn_complete")
				Vitest.assert.notStrictEqual(fact.value.contractKind, "turn_error")
			}
		}
		if (next.type === "TurnCompleted") {
			return next
		}
	}
	return Vitest.assert.fail("no TurnCompleted event arrived")
})

// Generous next to the rest of this file: a pending permission that is
// resolved at all is resolved by the abandoning path itself, synchronously,
// so anything past this is the forever-hang the tests below exist to catch.
const ABANDONED_DECISION_TIMEOUT = Duration.seconds(2)

// Folds what the adapter actually publishes through the REAL projector, so
// the assertion is "projection_pending_approvals no longer holds the row",
// not "the metadata looks about right". Stops early when the adapter's
// stream ends with the row still there — the stale-approval bug itself.
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

const fakeConnect = (
	inbound: Queue.Queue<Json, Done>,
	launches: Ref.Ref<Option.Option<GrokLaunchConfig>>,
	cancels: Ref.Ref<number>,
	cwds: Ref.Ref<ReadonlyArray<string>>,
	handshake: Ref.Ref<ReadonlyArray<HandshakeCall>>
) =>
	(input: GrokConnectInput) =>
		Effect.gen(function*() {
			yield* Ref.set(launches, Option.some(input.launch))
			yield* Stream.fromQueue(inbound).pipe(
				Stream.runForEach(input.onSessionUpdate),
				Effect.forkChild({ startImmediately: true })
			)
			return fakeHandle(inbound, cancels, cwds, handshake)
		})

Vitest.describe("Grok ACP SDK pin", () => {
	Vitest.it("uses ACP protocol version 1 from the stable SDK entry", () => {
		Vitest.assert.strictEqual(GROK_ACP_SDK_MODULE, "@agentclientprotocol/sdk")
		Vitest.assert.strictEqual(GROK_ACP_PROTOCOL_VERSION, 1)
	})
})

Vitest.describe("GrokAdapter", () => {
	Vitest.it.effect("starts a session with launch config from grok agent stdio", () =>
		Effect.gen(function*() {
			const inbound = yield* Queue.unbounded<Json, Done>()
			const launches = yield* Ref.make(Option.none<GrokLaunchConfig>())
			const cancels = yield* Ref.make(0)
			const cwds = yield* Ref.make<ReadonlyArray<string>>(Arr.empty())
			const handshake = yield* Ref.make<ReadonlyArray<HandshakeCall>>(Arr.empty())
			const adapter = yield* makeGrokAdapter({
				presence: Effect.succeed(grokPresence(true, true)),
				resolveLaunch: Effect.succeed(registryLaunch),
				resolveAuthenticate: Effect.succeed(grokAuthenticateParams(false)),
				connect: fakeConnect(inbound, launches, cancels, cwds, handshake)
			})
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
			Vitest.assert.strictEqual(opened.type, "SessionMetaUpdated")
			const fact = decodeContractFact(opened.metadata)
			Vitest.assert.isTrue(Option.isSome(fact))
			if (Option.isSome(fact) && fact.value.contractKind === "provider_session") {
				Vitest.assert.strictEqual(fact.value.providerSessionId, "acp-session-1")
			}
			const launch = yield* Ref.get(launches)
			Vitest.assert.deepStrictEqual(launch, Option.some(registryLaunch))
			Vitest.assert.deepStrictEqual(yield* Ref.get(cwds), ["/tmp/acepe"])
			Vitest.assert.deepStrictEqual(yield* Ref.get(handshake), [
				{ method: "initialize" },
				{ method: "authenticate", params: grokAuthenticateParams(false) },
				{ method: "newSession", cwd: "/tmp/acepe" }
			])
			yield* adapter.cancelTurn({ sessionId })
		})
	)

	Vitest.it.effect("authenticates with xai.api_key and _meta.headless when a key is present", () =>
		Effect.gen(function*() {
			const inbound = yield* Queue.unbounded<Json, Done>()
			const launches = yield* Ref.make(Option.none<GrokLaunchConfig>())
			const cancels = yield* Ref.make(0)
			const cwds = yield* Ref.make<ReadonlyArray<string>>(Arr.empty())
			const handshake = yield* Ref.make<ReadonlyArray<HandshakeCall>>(Arr.empty())
			const adapter = yield* makeGrokAdapter({
				presence: Effect.succeed(grokPresence(true, true)),
				resolveLaunch: Effect.succeed(registryLaunch),
				resolveAuthenticate: Effect.succeed(grokAuthenticateParams(true)),
				connect: fakeConnect(inbound, launches, cancels, cwds, handshake)
			})
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
			yield* Queue.take(events)
			const calls = yield* Ref.get(handshake)
			Vitest.assert.deepStrictEqual(
				Arr.map(calls, (call) => call.method),
				["initialize", "authenticate", "newSession"]
			)
			const authenticate = calls[1]
			Vitest.assert.deepStrictEqual(authenticate, {
				method: "authenticate",
				params: grokAuthenticateParams(true)
			})
			if (authenticate !== undefined && authenticate.method === "authenticate") {
				Vitest.assert.strictEqual("token" in authenticate.params, false)
				Vitest.assert.strictEqual("apiKey" in authenticate.params, false)
			}
			yield* adapter.cancelTurn({ sessionId })
		})
	)

	Vitest.it.effect("fails startSession with a named grok CLI error when the binary is missing", () =>
		Effect.gen(function*() {
			const adapter = yield* makeGrokAdapter({
				presence: Effect.succeed(grokPresence(false, false)),
				resolveLaunch: Effect.fail(missingGrokBinaryError()),
				resolveAuthenticate: Effect.succeed(grokAuthenticateParams(false)),
				connect: () => Effect.die("must not connect when the grok CLI is missing")
			})
			const error = yield* adapter
				.startSession({
					sessionId,
					projectId,
					workspaceRoot: "/tmp/acepe",
					envOverrides: {}
				})
				.pipe(Stream.runCollect, Effect.flip)
			Vitest.assert.strictEqual(error._tag, "ProviderAdapterError")
			Vitest.assert.strictEqual(error.operation, "startSession")
			Vitest.assert.strictEqual(error.providerId, "grok-build")
			Vitest.assert.isTrue(error.detail.includes("grok"))
		})
	)

	// The picker used to show the agent name disabled. This is the catalog
	// fact that replaces that fallback: Grok reports models on initialize
	// `_meta.modelState`, and the adapter publishes them as session_models.
	Vitest.it.effect("publishes the models Grok reports on initialize", () =>
		Effect.gen(function*() {
			const inbound = yield* Queue.unbounded<Json, Done>()
			const launches = yield* Ref.make(Option.none<GrokLaunchConfig>())
			const cancels = yield* Ref.make(0)
			const cwds = yield* Ref.make<ReadonlyArray<string>>(Arr.empty())
			const handshake = yield* Ref.make<ReadonlyArray<HandshakeCall>>(Arr.empty())
			const adapter = yield* makeGrokAdapter({
				presence: Effect.succeed(grokPresence(true, true)),
				resolveLaunch: Effect.succeed(registryLaunch),
				resolveAuthenticate: Effect.succeed(grokAuthenticateParams(false)),
				connect: (input: GrokConnectInput) =>
					Effect.gen(function*() {
						yield* Ref.set(launches, Option.some(input.launch))
						yield* Stream.fromQueue(inbound).pipe(
							Stream.runForEach(input.onSessionUpdate),
							Effect.forkChild({ startImmediately: true })
						)
						return fakeHandle(inbound, cancels, cwds, handshake, grokInitializeWithModels)
					})
			})
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
			let catalog: ReadonlyArray<{
				readonly modelId: string
				readonly name: string
				readonly description: string | null
			}> | null = null
			for (let attempt = 0; attempt < 8 && catalog === null; attempt++) {
				const next = yield* Queue.take(events).pipe(
					Effect.timeoutOption(Duration.millis(200)),
					Effect.orElseSucceed(() => Option.none<OrchestrationEvent>())
				)
				if (Option.isNone(next)) {
					break
				}
				if (next.value.type !== "SessionMetaUpdated") {
					continue
				}
				const fact = decodeSessionModelsFact(next.value.metadata)
				if (Option.isSome(fact)) {
					catalog = fact.value.models
				}
			}
			if (catalog === null) {
				return Vitest.assert.fail("the adapter never published the models Grok reported")
			}
			Vitest.assert.deepStrictEqual(catalog, [
				{
					modelId: "grok-4.6",
					name: "Grok 4.6",
					description: "SpaceXAI's latest frontier model"
				},
				{
					modelId: "grok-4.5",
					name: "Grok 4.5",
					description: null
				}
			])
			yield* adapter.cancelTurn({ sessionId })
		})
	)

	// Same structural opt-in setMode uses: ProviderBridge only forwards a
	// chosen model when the adapter exposes setModel. Grok's transport is
	// session/set_model against the agent's own session id.
	Vitest.it.effect("sends a set model as ACP session/set_model for the agent's session", () =>
		Effect.gen(function*() {
			const inbound = yield* Queue.unbounded<Json, Done>()
			const cancels = yield* Ref.make(0)
			const cwds = yield* Ref.make<ReadonlyArray<string>>(Arr.empty())
			const models = yield* Ref.make<
				ReadonlyArray<{ readonly providerSessionId: string; readonly modelId: string }>
			>(Arr.empty())
			const adapter = yield* makeGrokAdapter({
				presence: Effect.succeed(grokPresence(true, true)),
				resolveLaunch: Effect.succeed(registryLaunch),
				resolveAuthenticate: Effect.succeed(grokAuthenticateParams(false)),
				connect: () => Effect.succeed(modelRecordingHandle(inbound, cancels, cwds, models))
			})
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
			yield* Queue.take(events)
			yield* adapter.setModel({ sessionId, modelId: "grok-4.5" })
			Vitest.assert.deepStrictEqual(yield* Ref.get(models), [
				{ providerSessionId: "acp-session-1", modelId: "grok-4.5" }
			])
		})
	)

	// ACP's session/set_mode, against the agent's own session id rather than
	// Acepe's: the mode has to reach the running agent, so a set mode that
	// only updated adapter state would leave the agent in its previous mode.
	Vitest.it.effect("sends a set mode as ACP session/set_mode for the agent's session", () =>
		Effect.gen(function*() {
			const inbound = yield* Queue.unbounded<Json, Done>()
			const cancels = yield* Ref.make(0)
			const cwds = yield* Ref.make<ReadonlyArray<string>>(Arr.empty())
			const handshake = yield* Ref.make<ReadonlyArray<HandshakeCall>>(Arr.empty())
			const modes = yield* Ref.make<
				ReadonlyArray<{ readonly providerSessionId: string; readonly modeId: string }>
			>(Arr.empty())
			const adapter = yield* makeGrokAdapter({
				presence: Effect.succeed(grokPresence(true, true)),
				resolveLaunch: Effect.succeed(registryLaunch),
				resolveAuthenticate: Effect.succeed(grokAuthenticateParams(false)),
				connect: () => Effect.succeed(modeRecordingHandle(inbound, cancels, cwds, modes))
			})
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
			yield* Queue.take(events)
			yield* adapter.setMode({ sessionId, modeId: "plan" })
			Vitest.assert.deepStrictEqual(yield* Ref.get(modes), [
				{ providerSessionId: "acp-session-1", modeId: "plan" }
			])
		})
	)

	Vitest.it.effect("streams TokenAppended from ACP agent_message_chunk updates", () =>
		Effect.gen(function*() {
			const inbound = yield* Queue.unbounded<Json, Done>()
			const launches = yield* Ref.make(Option.none<GrokLaunchConfig>())
			const cancels = yield* Ref.make(0)
			const cwds = yield* Ref.make<ReadonlyArray<string>>(Arr.empty())
			const handshake = yield* Ref.make<ReadonlyArray<HandshakeCall>>(Arr.empty())
			const adapter = yield* makeGrokAdapter({
				presence: Effect.succeed(grokPresence(true, true)),
				resolveLaunch: Effect.succeed(registryLaunch),
				resolveAuthenticate: Effect.succeed(grokAuthenticateParams(false)),
				connect: fakeConnect(inbound, launches, cancels, cwds, handshake)
			})
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
			yield* Queue.take(events)
			yield* Stream.runCollect(
				adapter.sendPrompt({
					sessionId,
					messageId,
					text: "Hi"
				})
			)
			yield* Queue.offer(inbound, {
				sessionId: "acp-session-1",
				update: {
					sessionUpdate: "agent_message_chunk",
					content: {
						type: "text",
						text: "Hello"
					}
				}
			})
			const first = yield* Queue.take(events)
			const tokenEvent = first.type === "TokenAppended" ? first : yield* Queue.take(events)
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

	// An ACP tool_call update used to fold into the generic SessionMetaUpdated
	// branch, which ProjectionSessionActivities never reads: a Grok tool call
	// visibly ran while projection_session_activities stayed empty, so the
	// desktop showed no activity row for it. The later tool_call_update carries
	// only a toolCallId and a status, so the start info has to be cached to
	// keep one row growing across the whole lifecycle instead of two.
	Vitest.it.effect("emits ToolCallObserved for an ACP tool call and its status update", () =>
		Effect.gen(function*() {
			const inbound = yield* Queue.unbounded<Json, Done>()
			const launches = yield* Ref.make(Option.none<GrokLaunchConfig>())
			const cancels = yield* Ref.make(0)
			const cwds = yield* Ref.make<ReadonlyArray<string>>(Arr.empty())
			const handshake = yield* Ref.make<ReadonlyArray<HandshakeCall>>(Arr.empty())
			const adapter = yield* makeGrokAdapter({
				presence: Effect.succeed(grokPresence(true, true)),
				resolveLaunch: Effect.succeed(registryLaunch),
				resolveAuthenticate: Effect.succeed(grokAuthenticateParams(false)),
				connect: fakeConnect(inbound, launches, cancels, cwds, handshake)
			})
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
			yield* Queue.take(events)
			yield* Queue.offer(inbound, {
				sessionId: "acp-session-1",
				update: {
					sessionUpdate: "tool_call",
					toolCallId: "call_1",
					title: "Read file",
					kind: "read",
					status: "pending",
					rawInput: {
						path: "/tmp/acepe/a.ts"
					}
				}
			})
			const started = yield* nextToolCallObserved(events)
			if (started === undefined) {
				Vitest.assert.fail("expected a ToolCallObserved event for the ACP tool call")
				return
			}
			Vitest.assert.strictEqual(started.payload.sessionId, sessionId)
			Vitest.assert.strictEqual(started.payload.toolCallId, "call_1")
			Vitest.assert.strictEqual(started.payload.status, "pending")
			Vitest.assert.strictEqual(started.payload.title, "Read file")
			Vitest.assert.strictEqual(started.payload.path, "/tmp/acepe/a.ts")
			yield* Queue.offer(inbound, {
				sessionId: "acp-session-1",
				update: {
					sessionUpdate: "tool_call_update",
					toolCallId: "call_1",
					status: "completed",
					content: [{ type: "content", content: { type: "text", text: "export const a = 1" } }]
				}
			})
			const completed = yield* nextToolCallObserved(events)
			if (completed === undefined) {
				Vitest.assert.fail("expected a ToolCallObserved event for the ACP tool_call_update")
				return
			}
			Vitest.assert.strictEqual(completed.payload.status, "completed")
			// One row across start -> completion, so the projector merges them.
			Vitest.assert.strictEqual(completed.payload.activityId, started.payload.activityId)
			Vitest.assert.strictEqual(completed.payload.title, "Read file")
			Vitest.assert.strictEqual(completed.payload.path, "/tmp/acepe/a.ts")
			// #273: the settling update is the only message that carries the
			// tool's result, so a row that drops it shows the operator a
			// completed read with nothing read.
			Vitest.assert.strictEqual(completed.payload.output, "export const a = 1")
			yield* adapter.cancelTurn({ sessionId })
		})
	)

	// An ACP session/request_permission used to fold into the generic
	// makeMetaEvent/SessionMetaUpdated branch, whose metadata nobody reads for
	// approvals: ProjectionPendingApprovals.apply only reacts to a native
	// ApprovalRequested/InteractionReplied event or an explicitly stamped
	// pendingApproval metadata key. The desktop therefore had no approval row
	// to render, no InteractionReplied ever came back, and the ACP request the
	// agent was blocked on stayed pending for the rest of the turn. Same
	// carve-out ClaudeAdapter took for #268 defect 2.
	Vitest.it.effect("emits one answerable ApprovalRequested per ACP permission request", () =>
		Effect.gen(function*() {
			const inbound = yield* Queue.unbounded<Json, Done>()
			const cancels = yield* Ref.make(0)
			const cwds = yield* Ref.make<ReadonlyArray<string>>(Arr.empty())
			const handshake = yield* Ref.make<ReadonlyArray<HandshakeCall>>(Arr.empty())
			const asked = yield* Ref.make(Option.none<GrokConnectInput["onPermissionRequest"]>())
			const adapter = yield* makeGrokAdapter({
				presence: Effect.succeed(grokPresence(true, true)),
				resolveLaunch: Effect.succeed(registryLaunch),
				resolveAuthenticate: Effect.succeed(grokAuthenticateParams(false)),
				connect: (input: GrokConnectInput) =>
					Ref.set(asked, Option.some(input.onPermissionRequest)).pipe(
						Effect.as(fakeHandle(inbound, cancels, cwds, handshake))
					)
			})
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
			yield* Queue.take(events)
			const handler = yield* Ref.get(asked)
			if (Option.isNone(handler)) {
				Vitest.assert.fail("expected connect to receive an onPermissionRequest handler")
				return
			}
			const decisionFiber = yield* handler
				.value(acpPermissionRequest("call_9"))
				.pipe(Effect.forkChild({ startImmediately: true }))
			const requested = yield* nextApprovalRequested(events)
			if (requested === undefined) {
				Vitest.assert.fail("expected an ApprovalRequested event for the ACP permission request")
				return
			}
			Vitest.assert.strictEqual(requested.payload.sessionId, sessionId)
			Vitest.assert.strictEqual(requested.payload.approvalRequestId, "perm-call_9")
			Vitest.assert.strictEqual(requested.payload.title, "execute")
			yield* adapter.respondToPermission({
				sessionId,
				permissionId: requested.payload.approvalRequestId,
				decision: "allow"
			})
			Vitest.assert.strictEqual(yield* Fiber.join(decisionFiber), "allow")
			yield* adapter.cancelTurn({ sessionId })
		})
	)

	// ACP hands the client no id of its own for session/request_permission, so
	// the approval id is derived from the tool call. A tool call that asks
	// twice — a second permission scope, or a retry after a rejection — used
	// to produce two approvals under one id: the second deferred evicted the
	// first from pendingPermissions, the single answer released the second,
	// and the first ACP request stayed pending for the rest of the turn.
	Vitest.it.effect("answers both permission requests raised by one tool call", () =>
		Effect.gen(function*() {
			const inbound = yield* Queue.unbounded<Json, Done>()
			const cancels = yield* Ref.make(0)
			const cwds = yield* Ref.make<ReadonlyArray<string>>(Arr.empty())
			const handshake = yield* Ref.make<ReadonlyArray<HandshakeCall>>(Arr.empty())
			const asked = yield* Ref.make(Option.none<GrokConnectInput["onPermissionRequest"]>())
			const adapter = yield* makeGrokAdapter({
				presence: Effect.succeed(grokPresence(true, true)),
				resolveLaunch: Effect.succeed(registryLaunch),
				resolveAuthenticate: Effect.succeed(grokAuthenticateParams(false)),
				connect: (input: GrokConnectInput) =>
					Ref.set(asked, Option.some(input.onPermissionRequest)).pipe(
						Effect.as(fakeHandle(inbound, cancels, cwds, handshake))
					)
			})
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
			yield* Queue.take(events)
			const handler = yield* Ref.get(asked)
			if (Option.isNone(handler)) {
				Vitest.assert.fail("expected connect to receive an onPermissionRequest handler")
				return
			}
			const firstFiber = yield* handler
				.value(acpPermissionRequest("call_9"))
				.pipe(Effect.forkChild({ startImmediately: true }))
			const first = yield* nextApprovalRequested(events)
			const secondFiber = yield* handler
				.value(acpPermissionRequest("call_9"))
				.pipe(Effect.forkChild({ startImmediately: true }))
			const second = yield* nextApprovalRequested(events)
			if (first === undefined || second === undefined) {
				Vitest.assert.fail("expected an ApprovalRequested event for each ACP permission request")
				return
			}
			Vitest.assert.strictEqual(first.payload.approvalRequestId, "perm-call_9")
			Vitest.assert.notStrictEqual(
				second.payload.approvalRequestId,
				first.payload.approvalRequestId
			)
			yield* adapter.respondToPermission({
				sessionId,
				permissionId: first.payload.approvalRequestId,
				decision: "allow"
			})
			yield* adapter.respondToPermission({
				sessionId,
				permissionId: second.payload.approvalRequestId,
				decision: "deny"
			})
			Vitest.assert.strictEqual(yield* Fiber.join(firstFiber), "allow")
			Vitest.assert.strictEqual(yield* Fiber.join(secondFiber), "deny")
			yield* adapter.cancelTurn({ sessionId })
		})
	)

	// A pending ACP permission blocks the agent's own
	// session/request_permission call on decidePermission's Deferred (see
	// Permissions.ts), and the ACP SDK awaits that promise on a handler the
	// adapter cannot interrupt. cancelTurn ended outbound, closed the handle
	// and dropped the session from `sessions` without ever resolving it, so
	// the handler waited forever AND respondToPermission could no longer
	// reach the session that owned the deferred. Same abandoning paths
	// ClaudeAdapter already covers with drainPendingPermissions.
	Vitest.it.live("cancelTurn denies a permission the ACP client is still blocked on", () =>
		Effect.gen(function*() {
			const inbound = yield* Queue.unbounded<Json, Done>()
			const cancels = yield* Ref.make(0)
			const cwds = yield* Ref.make<ReadonlyArray<string>>(Arr.empty())
			const handshake = yield* Ref.make<ReadonlyArray<HandshakeCall>>(Arr.empty())
			const asked = yield* Ref.make(Option.none<GrokConnectInput["onPermissionRequest"]>())
			const adapter = yield* makeGrokAdapter({
				presence: Effect.succeed(grokPresence(true, true)),
				resolveLaunch: Effect.succeed(registryLaunch),
				resolveAuthenticate: Effect.succeed(grokAuthenticateParams(false)),
				connect: (input: GrokConnectInput) =>
					Ref.set(asked, Option.some(input.onPermissionRequest)).pipe(
						Effect.as(fakeHandle(inbound, cancels, cwds, handshake))
					)
			})
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
			yield* Queue.take(events)
			const handler = yield* Ref.get(asked)
			if (Option.isNone(handler)) {
				Vitest.assert.fail("expected connect to receive an onPermissionRequest handler")
				return
			}
			const decisionFiber = yield* handler
				.value(acpPermissionRequest("call_9"))
				.pipe(Effect.forkChild({ startImmediately: true }))
			yield* nextApprovalRequested(events)
			yield* adapter.cancelTurn({ sessionId })
			const decision = yield* Fiber.join(decisionFiber).pipe(
				Effect.timeoutOption(ABANDONED_DECISION_TIMEOUT)
			)
			if (Option.isNone(decision)) {
				Vitest.assert.fail("cancelTurn left the ACP permission request pending forever")
				return
			}
			Vitest.assert.strictEqual(decision.value, "deny")
		})
	)

	Vitest.it.live("shutdown denies a permission the ACP client is still blocked on", () =>
		Effect.gen(function*() {
			const inbound = yield* Queue.unbounded<Json, Done>()
			const cancels = yield* Ref.make(0)
			const cwds = yield* Ref.make<ReadonlyArray<string>>(Arr.empty())
			const handshake = yield* Ref.make<ReadonlyArray<HandshakeCall>>(Arr.empty())
			const asked = yield* Ref.make(Option.none<GrokConnectInput["onPermissionRequest"]>())
			const adapter = yield* makeGrokAdapter({
				presence: Effect.succeed(grokPresence(true, true)),
				resolveLaunch: Effect.succeed(registryLaunch),
				resolveAuthenticate: Effect.succeed(grokAuthenticateParams(false)),
				connect: (input: GrokConnectInput) =>
					Ref.set(asked, Option.some(input.onPermissionRequest)).pipe(
						Effect.as(fakeHandle(inbound, cancels, cwds, handshake))
					)
			})
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
			yield* Queue.take(events)
			const handler = yield* Ref.get(asked)
			if (Option.isNone(handler)) {
				Vitest.assert.fail("expected connect to receive an onPermissionRequest handler")
				return
			}
			const decisionFiber = yield* handler
				.value(acpPermissionRequest("call_9"))
				.pipe(Effect.forkChild({ startImmediately: true }))
			yield* nextApprovalRequested(events)
			yield* adapter.shutdown
			const decision = yield* Fiber.join(decisionFiber).pipe(
				Effect.timeoutOption(ABANDONED_DECISION_TIMEOUT)
			)
			if (Option.isNone(decision)) {
				Vitest.assert.fail("shutdown left the ACP permission request pending forever")
				return
			}
			Vitest.assert.strictEqual(decision.value, "deny")
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
			const cancels = yield* Ref.make(0)
			const cwds = yield* Ref.make<ReadonlyArray<string>>(Arr.empty())
			const handshake = yield* Ref.make<ReadonlyArray<HandshakeCall>>(Arr.empty())
			const asked = yield* Ref.make(Option.none<GrokConnectInput["onPermissionRequest"]>())
			const adapter = yield* makeGrokAdapter({
				presence: Effect.succeed(grokPresence(true, true)),
				resolveLaunch: Effect.succeed(registryLaunch),
				resolveAuthenticate: Effect.succeed(grokAuthenticateParams(false)),
				connect: (input: GrokConnectInput) =>
					Ref.set(asked, Option.some(input.onPermissionRequest)).pipe(
						Effect.as(fakeHandle(inbound, cancels, cwds, handshake))
					)
			})
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
			yield* Queue.take(events)
			const handler = yield* Ref.get(asked)
			if (Option.isNone(handler)) {
				Vitest.assert.fail("expected connect to receive an onPermissionRequest handler")
				return
			}
			yield* handler
				.value(acpPermissionRequest("call_9"))
				.pipe(Effect.forkChild({ startImmediately: true }))
			const requested = yield* nextApprovalRequested(events)
			if (requested === undefined) {
				Vitest.assert.fail("expected an ApprovalRequested event for the ACP permission request")
				return
			}
			const pending = yield* evolveProjectedPendingApprovals(Arr.empty(), requested)
			Vitest.assert.strictEqual(pending.length, 1)
			yield* adapter.cancelTurn({ sessionId })
			Vitest.assert.deepStrictEqual(yield* projectUntilCleared(events, pending), [])
		})
	)

	Vitest.it.effect("cancelTurn notifies the ACP session and emits TurnCancelled", () =>
		Effect.gen(function*() {
			const inbound = yield* Queue.unbounded<Json, Done>()
			const launches = yield* Ref.make(Option.none<GrokLaunchConfig>())
			const cancels = yield* Ref.make(0)
			const cwds = yield* Ref.make<ReadonlyArray<string>>(Arr.empty())
			const handshake = yield* Ref.make<ReadonlyArray<HandshakeCall>>(Arr.empty())
			const adapter = yield* makeGrokAdapter({
				presence: Effect.succeed(grokPresence(true, true)),
				resolveLaunch: Effect.succeed(registryLaunch),
				resolveAuthenticate: Effect.succeed(grokAuthenticateParams(false)),
				connect: fakeConnect(inbound, launches, cancels, cwds, handshake)
			})
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
			yield* Queue.take(events)
			yield* adapter.cancelTurn({ sessionId })
			const cancelled = yield* Queue.take(events)
			Vitest.assert.strictEqual(cancelled.type, "TurnCancelled")
			Vitest.assert.strictEqual(yield* Ref.get(cancels), 1)
		})
	)

	// grok's own end_turn is the only thing that closes an open
	// projection_turns row absent a cancellation or a second prompt (see
	// projectTurnCompleted in ProjectionTurns.ts, whose SessionMetaUpdated
	// branch is a no-op). Without the typed event the composer keeps showing
	// "Interrupt" for a turn the agent already finished.
	Vitest.it.effect("closes a finished turn with a TurnCompleted event", () =>
		Effect.gen(function*() {
			const inbound = yield* Queue.unbounded<Json, Done>()
			const cancels = yield* Ref.make(0)
			const cwds = yield* Ref.make<ReadonlyArray<string>>(Arr.empty())
			const handshake = yield* Ref.make<ReadonlyArray<HandshakeCall>>(Arr.empty())
			const adapter = yield* makeGrokAdapter({
				presence: Effect.succeed(grokPresence(true, true)),
				resolveLaunch: Effect.succeed(registryLaunch),
				resolveAuthenticate: Effect.succeed(grokAuthenticateParams(false)),
				connect: () => Effect.succeed(stoppingHandle(inbound, cancels, cwds, "end_turn"))
			})
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
			yield* Queue.take(events)
			yield* Stream.runCollect(adapter.sendPrompt({ sessionId, messageId, text: "Hi" }))
			const completed = yield* nextTurnCompleted(events)
			Vitest.assert.strictEqual(completed.payload.sessionId, sessionId)
		})
	)

	// projection_turns has no "failed" status, so an errored turn closes as
	// completed instead of staying open — the same call Codex and OpenCode
	// already make for their own turn_error.
	Vitest.it.effect("closes an errored turn with TurnCompleted too", () =>
		Effect.gen(function*() {
			const inbound = yield* Queue.unbounded<Json, Done>()
			const cancels = yield* Ref.make(0)
			const cwds = yield* Ref.make<ReadonlyArray<string>>(Arr.empty())
			const handshake = yield* Ref.make<ReadonlyArray<HandshakeCall>>(Arr.empty())
			const adapter = yield* makeGrokAdapter({
				presence: Effect.succeed(grokPresence(true, true)),
				resolveLaunch: Effect.succeed(registryLaunch),
				resolveAuthenticate: Effect.succeed(grokAuthenticateParams(false)),
				connect: () => Effect.succeed(stoppingHandle(inbound, cancels, cwds, "refusal"))
			})
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
			yield* Queue.take(events)
			yield* Stream.runCollect(adapter.sendPrompt({ sessionId, messageId, text: "Hi" }))
			const completed = yield* nextTurnCompleted(events)
			Vitest.assert.strictEqual(completed.payload.sessionId, sessionId)
		})
	)
})

Vitest.layer(Platform)("Grok folder source and fixtures", (it) => {
	it.effect("keeps every file in the folder off the experimental ACP entry", () =>
		Effect.gen(function*() {
			const scanned = yield* folderSources
			Vitest.assert.isTrue(Arr.isReadonlyArrayNonEmpty(scanned))
			const offenders = Arr.map(
				Arr.filter(scanned, (entry) => Str.includes(FORBIDDEN_ACP_ENTRY)(entry.source)),
				(entry) => entry.name
			)
			Vitest.assert.deepStrictEqual(offenders, [])
		})
	)

	it.effect("keeps one file in the folder on the stable ACP SDK transport", () =>
		Effect.gen(function*() {
			const scanned = yield* folderSources
			const transports = Arr.map(
				Arr.filter(
					scanned,
					(entry) =>
						Str.includes(STABLE_ACP_ENTRY)(entry.source) &&
						Str.includes(STABLE_ACP_TRANSPORT)(entry.source)
				),
				(entry) => entry.name
			)
			Vitest.assert.isTrue(Arr.isReadonlyArrayNonEmpty(transports))
		})
	)

	it.effect("finds no recorded Grok fixture under packages/harness/fixtures", () =>
		Effect.gen(function*() {
			const path = yield* Path.Path
			const fs = yield* FileSystem.FileSystem
			// Resolved through the package, so moving this test between folders cannot break it.
			const harnessEntry = yield* path.fromFileUrl(new URL(import.meta.resolve("@acepe/harness")))
			const fixturesDir = path.join(path.dirname(path.dirname(harnessEntry)), "fixtures")
			const names = yield* fs.readDirectory(fixturesDir)
			const grokNames = Arr.filter(names, (name) => Str.includes("grok")(Str.toLowerCase(name)))
			Vitest.assert.deepStrictEqual(grokNames, [])
		})
	)
})
