import { MessageId, ProjectId, SessionId } from "@acepe/contracts"
import * as BunFileSystem from "@effect/platform-bun/BunFileSystem"
import * as BunPath from "@effect/platform-bun/BunPath"
import * as Vitest from "@effect/vitest"
import * as Deferred from "effect/Deferred"
import * as Duration from "effect/Duration"
import * as Effect from "effect/Effect"
import * as FileSystem from "effect/FileSystem"
import * as Layer from "effect/Layer"
import * as Option from "effect/Option"
import * as Path from "effect/Path"
import * as Stream from "effect/Stream"
import { makeLiveClaudeAdapter } from "./ClaudeAdapter.ts"
import { probeClaudePresence } from "./ClaudeProvider.ts"
import { decodeContractFact } from "./ClaudeSdkMap.ts"

const PlatformLive = Layer.mergeAll(BunFileSystem.layer, BunPath.layer)

// This is the ONE real-adapter integration test called for by the
// real-provider-wiring lane: it drives ClaudeAdapter.ts's live constructor
// against the real @anthropic-ai/claude-agent-sdk `query()` (no fake
// createQuery), exactly the seam ProviderBridge.ts uses in production. If
// this machine has no Claude CLI/credentials, it skips cleanly — it must
// never fabricate a reply.
Vitest.describe("ClaudeAdapter (live integration)", () => {
	Vitest.it.live(
		"streams a real reply from the Claude Agent SDK",
		() =>
			Effect.gen(function*() {
				const presence = yield* probeClaudePresence()
				// probeClaudePresence()'s `authenticated` check only looks for
				// ~/.claude/.credentials.json; it does not know about Keychain-based
				// OAuth storage, so it can under-report here. `installed` is enough
				// to gate on — the real query() call below resolves credentials
				// itself, and any auth failure surfaces as a real ProviderAdapterError
				// below rather than a silent, possibly-wrong skip.
				if (!presence.installed) {
					yield* Effect.logWarning(
						"Skipping live Claude integration test: the Claude CLI is not on PATH on this machine."
					)
					return
				}

				const fs = yield* FileSystem.FileSystem
				const workspaceRoot = yield* fs.makeTempDirectoryScoped()
				const adapter = yield* makeLiveClaudeAdapter()
				const sessionId = SessionId.make("live-integration-session")
				const projectId = ProjectId.make("live-integration-project")
				const messageId = MessageId.make("live-integration-message")

				const collectedTokens: Array<string> = []
				let turnDone = false
				// ClaudeAdapter.ts only registers its internal session once its
				// startSession stream actually starts running (inside
				// Stream.unwrap), so sendPrompt below must wait for that — the
				// same race ProviderBridge.ts's openSession guards against via
				// forwardAdapterEvents' `ready` Deferred.
				const started = yield* Deferred.make<void>()

				yield* adapter.startSession({ sessionId, projectId, workspaceRoot }).pipe(
					Stream.tap(() => Deferred.succeed(started, undefined)),
					Stream.tap((event) =>
						Effect.sync(() => {
							if (event.type === "TokenAppended") {
								collectedTokens.push(event.payload.token)
								return
							}
							if (event.type === "SessionMetaUpdated") {
								const fact = decodeContractFact(event.metadata)
								if (
									Option.isSome(fact) &&
									(fact.value.contractKind === "turn_complete" || fact.value.contractKind === "turn_error")
								) {
									turnDone = true
								}
							}
						})
					),
					Stream.runDrain,
					Effect.ensuring(Deferred.succeed(started, undefined)),
					Effect.forkScoped
				)

				yield* Deferred.await(started)
				yield* Stream.runDrain(
					adapter.sendPrompt({
						sessionId,
						messageId,
						text: "Reply with exactly: PING_TEST_OK and nothing else."
					})
				)

				let waitedSeconds = 0
				while (!turnDone && waitedSeconds < 60) {
					yield* Effect.sleep(Duration.seconds(1))
					waitedSeconds += 1
				}
				yield* adapter.cancelTurn({ sessionId }).pipe(Effect.ignore)

				const reply = collectedTokens.join("")
				Vitest.assert.isTrue(
					reply.includes("PING_TEST_OK"),
					`Expected the real Claude reply to include PING_TEST_OK, got: "${reply}"`
				)
			}).pipe(
				// @effect-diagnostics-next-line strictEffectProvide:off
				Effect.provide(PlatformLive)
			),
		{ timeout: 90_000 }
	)
})
