import { MessageId, type OrchestrationEvent, ProjectId, SessionId } from "@acepe/contracts"
import * as Vitest from "@effect/vitest"
import * as Arr from "effect/Array"
import type { Done } from "effect/Cause"
import * as Effect from "effect/Effect"
import * as Option from "effect/Option"
import * as Queue from "effect/Queue"
import * as Ref from "effect/Ref"
import * as Stream from "effect/Stream"
import { EMPTY_JSON_OBJECT, type Json } from "../Json.ts"
import { makeGrokAdapter } from "./Adapter.ts"
import type { GrokAcpHandle, GrokConnectInput, GrokLaunchConfig } from "./Process.ts"
import { grokAuthenticateParams, grokPresence } from "./Provider.ts"

const sessionId = SessionId.make("session-1")
const projectId = ProjectId.make("project-1")
const messageId = MessageId.make("message-user")
const registryLaunch: GrokLaunchConfig = {
	command: "/usr/local/bin/grok",
	args: ["agent", "stdio"]
}

// New-chat dispatches message.send in the same breath as session.create.
// Grok's handshake (initialize, authenticate, session/new) takes seconds,
// and the adapter used to register the runtime before session/new returned.
// sendPrompt then failed with "Grok ACP session id is missing" instead of
// waiting, which the live composer surfaces as ProviderSessionFailed.
Vitest.describe("GrokAdapter handshake", () => {
	Vitest.it.effect("waits for session/new before sendPrompt talks to Grok", () =>
		Effect.gen(function*() {
			const inbound = yield* Queue.unbounded<Json, Done>()
			const prompts = yield* Ref.make<ReadonlyArray<string>>(Arr.empty())
			const handle: GrokAcpHandle = {
				initialize: Effect.succeed(EMPTY_JSON_OBJECT),
				authenticate: () => Effect.void,
				newSession: () => Effect.succeed("acp-session-1"),
				prompt: (_providerSessionId, text) =>
					Ref.update(prompts, (current) => Arr.append(current, text)).pipe(
						Effect.as(Option.none())
					),
				cancel: () => Effect.void,
				setMode: () => Effect.void,
				setModel: () => Effect.void,
				close: Queue.end(inbound).pipe(Effect.asVoid)
			}
			const adapter = yield* makeGrokAdapter({
				presence: Effect.succeed(grokPresence(true, true)),
				resolveLaunch: Effect.succeed(registryLaunch),
				resolveAuthenticate: Effect.succeed(grokAuthenticateParams(false)),
				connect: (_input: GrokConnectInput) => Effect.succeed(handle)
			})
			const outbound = yield* Queue.unbounded<OrchestrationEvent, Done>()
			yield* adapter
				.startSession({
					sessionId,
					projectId,
					workspaceRoot: "/tmp/acepe",
					envOverrides: {}
				})
				.pipe(
					Stream.runForEach((event) => Queue.offer(outbound, event).pipe(Effect.asVoid)),
					Effect.forkChild({ startImmediately: true })
				)
			yield* Queue.take(outbound)
			const sent = yield* Stream.runCollect(
				adapter.sendPrompt({
					sessionId,
					messageId,
					text: "Hi"
				})
			)
			yield* adapter.cancelTurn({ sessionId })
			Vitest.assert.strictEqual(Arr.fromIterable(sent)[0]?.type, "MessageSent")
			Vitest.assert.deepStrictEqual(yield* Ref.get(prompts), ["Hi"])
		})
	)
})
