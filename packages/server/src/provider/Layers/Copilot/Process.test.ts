import * as BunChildProcessSpawner from "@effect/platform-bun/BunChildProcessSpawner"
import * as BunFileSystem from "@effect/platform-bun/BunFileSystem"
import * as BunPath from "@effect/platform-bun/BunPath"
import * as Vitest from "@effect/vitest"
import * as Arr from "effect/Array"
import type { Done } from "effect/Cause"
import * as Deferred from "effect/Deferred"
import * as Effect from "effect/Effect"
import * as HashMap from "effect/HashMap"
import * as Layer from "effect/Layer"
import * as Option from "effect/Option"
import * as Queue from "effect/Queue"
import * as Ref from "effect/Ref"
import * as Stream from "effect/Stream"
import * as ChildProcessSpawner from "effect/unstable/process/ChildProcessSpawner"
import type { ProviderAdapterError } from "../../Services/ProviderAdapter.ts"
import type { Json } from "../Json.ts"
import { handleStdoutLine, liveCreateTransport } from "./Process.ts"

// The same shape Process.ts keeps in its pending map. Written out here rather
// than exported from the module, because nothing outside the transport has
// any business holding one.
type PendingRequest = {
	readonly method: string
	readonly deferred: Deferred.Deferred<Json, ProviderAdapterError>
}

const emptyPending = Ref.make(HashMap.empty<string, PendingRequest>())

const waitingOn = Effect.fn("waitingOn")(function*(id: string, method: string) {
	const deferred = yield* Deferred.make<Json, ProviderAdapterError>()
	const pending = yield* Ref.make(
		HashMap.make([id, { method, deferred }] as const)
	)
	return { pending, deferred }
})

Vitest.describe("handleStdoutLine", () => {
	Vitest.it.effect("answers the request whose id the line repeats", () =>
		Effect.gen(function*() {
			const waiting = yield* waitingOn("1", "session/new")
			const notifications = yield* Queue.unbounded<Json, Done>()
			yield* handleStdoutLine(
				`{"jsonrpc":"2.0","id":1,"result":{"sessionId":"acp-copilot-1"}}`,
				waiting.pending,
				notifications
			)
			Vitest.assert.deepStrictEqual(yield* Deferred.await(waiting.deferred), {
				sessionId: "acp-copilot-1"
			})
			Vitest.assert.isTrue(HashMap.isEmpty(yield* Ref.get(waiting.pending)))
		})
	)

	Vitest.it.effect("fails the request whose answer carries an error", () =>
		Effect.gen(function*() {
			const waiting = yield* waitingOn("1", "session/prompt")
			const notifications = yield* Queue.unbounded<Json, Done>()
			yield* handleStdoutLine(
				`{"jsonrpc":"2.0","id":1,"error":{"code":-32600,"message":"nope"}}`,
				waiting.pending,
				notifications
			)
			const failure = yield* waiting.deferred.pipe(Deferred.await, Effect.flip)
			Vitest.assert.strictEqual(failure.operation, "sendPrompt")
		})
	)

	// An agent-initiated request looks like a line with an id and no answer.
	// It has to reach the notification stream, because that is the only thing
	// Session.ts reads and a permission prompt arrives this way.
	Vitest.it.effect("passes an agent request on to the notification stream", () =>
		Effect.gen(function*() {
			const pending = yield* emptyPending
			const notifications = yield* Queue.unbounded<Json, Done>()
			yield* handleStdoutLine(
				`{"jsonrpc":"2.0","id":41,"method":"session/request_permission","params":{"sessionId":"acp-copilot-1"}}`,
				pending,
				notifications
			)
			const received = yield* Queue.take(notifications)
			Vitest.assert.deepStrictEqual(received, {
				jsonrpc: "2.0",
				id: 41,
				method: "session/request_permission",
				params: { sessionId: "acp-copilot-1" }
			})
		})
	)

	// The CLI prints progress and warnings on the same descriptor, so a line
	// that is not JSON is a log line and not a protocol fault. Ending the
	// session over one would kill a working turn.
	Vitest.it.effect("drops a line that is not JSON instead of failing", () =>
		Effect.gen(function*() {
			const pending = yield* emptyPending
			const notifications = yield* Queue.unbounded<Json, Done>()
			yield* handleStdoutLine("Downloading model...", pending, notifications)
			Vitest.assert.strictEqual(yield* Queue.size(notifications), 0)
		})
	)
})

const PlatformLive = BunChildProcessSpawner.layer.pipe(
	Layer.provideMerge(Layer.mergeAll(BunFileSystem.layer, BunPath.layer))
)

Vitest.layer(PlatformLive)("liveCreateTransport", (it) => {
	// `cat` echoes stdin back on stdout, so one request proves the whole
	// frame: the line the transport writes, the newline it terminates it
	// with, and the reader that turns the echoed line back into a message.
	it.effect("frames a request as one newline-terminated JSON-RPC line", () =>
		Effect.gen(function*() {
			const spawner = yield* ChildProcessSpawner.ChildProcessSpawner
			const scope = yield* Effect.scope
			const handle = yield* liveCreateTransport({
				cwd: "/tmp",
				envOverrides: {},
				launch: { command: "cat", args: Arr.empty() },
				spawner,
				scope
			})
			yield* handle
				.request("session/new", { cwd: "/tmp" })
				.pipe(Effect.forkChild({ startImmediately: true }))
			// The echo comes back with an id and no result, so the reader
			// treats it as an agent message rather than an answer.
			const echoed = yield* Stream.runHead(handle.notifications)
			Vitest.assert.deepStrictEqual(
				echoed,
				Option.some({
					jsonrpc: "2.0",
					id: 1,
					method: "session/new",
					params: { cwd: "/tmp" }
				})
			)
			yield* handle.close
		}).pipe(Effect.scoped)
	)
})
