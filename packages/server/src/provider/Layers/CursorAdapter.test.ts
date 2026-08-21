import {
	type OrchestrationEvent,
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
import * as Effect from "effect/Effect"
import * as FileSystem from "effect/FileSystem"
import * as Layer from "effect/Layer"
import * as Option from "effect/Option"
import * as Path from "effect/Path"
import * as Queue from "effect/Queue"
import * as Ref from "effect/Ref"
import * as Schema from "effect/Schema"
import * as Stream from "effect/Stream"
import * as Str from "effect/String"
import {
	CURSOR_ACP_PROTOCOL_VERSION,
	CURSOR_ACP_SDK_MODULE,
	makeCursorAdapter,
	type CursorAcpHandle,
	type CursorConnectInput,
	type CursorLaunchConfig
} from "./CursorAdapter.ts"
import { cursorPresence } from "./CursorProvider.ts"
import { decodeContractFact } from "./CursorAcpMap.ts"

type Json = typeof Schema.Json.Type

const sessionId = SessionId.make("session-1")
const projectId = ProjectId.make("project-1")
const messageId = MessageId.make("message-user")
const registryLaunch: CursorLaunchConfig = {
	command: "/cache/cursor/dist-package/cursor-agent",
	args: ["acp"]
}

const Platform = Layer.mergeAll(BunFileSystem.layer, BunPath.layer)

const fakeHandle = (
	inbound: Queue.Queue<Json, Done>,
	cancels: Ref.Ref<number>,
	cwds: Ref.Ref<ReadonlyArray<string>>
): CursorAcpHandle => ({
	initialize: Effect.void,
	newSession: (cwd: string) =>
		Ref.update(cwds, (current) => Arr.append(current, cwd)).pipe(
			Effect.as("acp-session-1")
		),
	prompt: () => Effect.succeed(Option.none()),
	cancel: () => Ref.update(cancels, (count) => count + 1).pipe(Effect.asVoid),
	close: Queue.end(inbound).pipe(Effect.asVoid)
})

const fakeConnect = (
	inbound: Queue.Queue<Json, Done>,
	launches: Ref.Ref<Option.Option<CursorLaunchConfig>>,
	cancels: Ref.Ref<number>,
	cwds: Ref.Ref<ReadonlyArray<string>>
) =>
	(input: CursorConnectInput) =>
		Effect.gen(function*() {
			yield* Ref.set(launches, Option.some(input.launch))
			yield* Stream.fromQueue(inbound).pipe(
				Stream.runForEach(input.onSessionUpdate),
				Effect.forkChild({ startImmediately: true })
			)
			return fakeHandle(inbound, cancels, cwds)
		})

Vitest.describe("Cursor ACP SDK pin", () => {
	Vitest.it("uses ACP protocol version 1 from the stable SDK entry", () => {
		Vitest.assert.strictEqual(CURSOR_ACP_SDK_MODULE, "@agentclientprotocol/sdk")
		Vitest.assert.strictEqual(CURSOR_ACP_PROTOCOL_VERSION, 1)
	})
})

Vitest.describe("CursorAdapter", () => {
	Vitest.it.effect("starts a session with launch config from cursor/agent.json", () =>
		Effect.gen(function*() {
			const inbound = yield* Queue.unbounded<Json, Done>()
			const launches = yield* Ref.make(Option.none<CursorLaunchConfig>())
			const cancels = yield* Ref.make(0)
			const cwds = yield* Ref.make<ReadonlyArray<string>>(Arr.empty())
			const adapter = yield* makeCursorAdapter({
				presence: Effect.succeed(cursorPresence(true, true)),
				resolveLaunch: Effect.succeed(registryLaunch),
				connect: fakeConnect(inbound, launches, cancels, cwds)
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
			if (Option.isSome(fact) && fact.value.contractKind === "provider_session") {
				Vitest.assert.strictEqual(fact.value.providerSessionId, "acp-session-1")
			}
			const launch = yield* Ref.get(launches)
			Vitest.assert.deepStrictEqual(launch, Option.some(registryLaunch))
			Vitest.assert.deepStrictEqual(yield* Ref.get(cwds), ["/tmp/acepe"])
			yield* adapter.cancelTurn({ sessionId })
		})
	)

	Vitest.it.effect("streams TokenAppended from ACP agent_message_chunk updates", () =>
		Effect.gen(function*() {
			const inbound = yield* Queue.unbounded<Json, Done>()
			const launches = yield* Ref.make(Option.none<CursorLaunchConfig>())
			const cancels = yield* Ref.make(0)
			const cwds = yield* Ref.make<ReadonlyArray<string>>(Arr.empty())
			const adapter = yield* makeCursorAdapter({
				presence: Effect.succeed(cursorPresence(true, true)),
				resolveLaunch: Effect.succeed(registryLaunch),
				connect: fakeConnect(inbound, launches, cancels, cwds)
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

	Vitest.it.effect("cancelTurn notifies the ACP session and emits TurnCancelled", () =>
		Effect.gen(function*() {
			const inbound = yield* Queue.unbounded<Json, Done>()
			const launches = yield* Ref.make(Option.none<CursorLaunchConfig>())
			const cancels = yield* Ref.make(0)
			const cwds = yield* Ref.make<ReadonlyArray<string>>(Arr.empty())
			const adapter = yield* makeCursorAdapter({
				presence: Effect.succeed(cursorPresence(true, true)),
				resolveLaunch: Effect.succeed(registryLaunch),
				connect: fakeConnect(inbound, launches, cancels, cwds)
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
			Vitest.assert.strictEqual(yield* Ref.get(cancels), 1)
		})
	)
})

Vitest.layer(Platform)("CursorAdapter source and fixtures", (it) => {
	it.effect("does not import experimental/v2", () =>
		Effect.gen(function*() {
			const path = yield* Path.Path
			const fs = yield* FileSystem.FileSystem
			const here = yield* path.fromFileUrl(new URL(import.meta.url))
			const source = yield* fs.readFileString(path.join(path.dirname(here), "CursorAdapter.ts"))
			Vitest.assert.isTrue(Str.includes("@agentclientprotocol/sdk")(source))
			Vitest.assert.isFalse(Str.includes("experimental/v2")(source))
		})
	)

	it.effect("finds no recorded Cursor fixture under packages/harness/fixtures", () =>
		Effect.gen(function*() {
			const path = yield* Path.Path
			const fs = yield* FileSystem.FileSystem
			const here = yield* path.fromFileUrl(new URL(import.meta.url))
			const fixturesDir = path.join(
				path.dirname(here),
				"..",
				"..",
				"..",
				"..",
				"harness",
				"fixtures"
			)
			const names = yield* fs.readDirectory(fixturesDir)
			const cursorNames = Arr.filter(names, (name) => Str.includes("cursor")(Str.toLowerCase(name)))
			Vitest.assert.deepStrictEqual(cursorNames, [])
		})
	)
})
