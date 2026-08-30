import * as Arr from "effect/Array"
import type { Done } from "effect/Cause"
import * as Deferred from "effect/Deferred"
import * as Effect from "effect/Effect"
import * as HashMap from "effect/HashMap"
import * as Option from "effect/Option"
import * as Predicate from "effect/Predicate"
import * as Queue from "effect/Queue"
import * as Ref from "effect/Ref"
import * as Schema from "effect/Schema"
import * as Scope from "effect/Scope"
import * as Stream from "effect/Stream"
import * as Str from "effect/String"
import * as ChildProcess from "effect/unstable/process/ChildProcess"
import * as ChildProcessSpawner from "effect/unstable/process/ChildProcessSpawner"
import type { ProviderAdapterError } from "../../Services/ProviderAdapter.ts"
import { EMPTY_JSON_OBJECT, field, type Json } from "../Json.ts"
import { adapterError, type CopilotLaunchConfig } from "./Provider.ts"
import { type AgentEnvOverrides, agentChildProcess } from "../../AgentEnv.ts"

const encodeJsonLine = Schema.encodeUnknownEffect(Schema.fromJsonString(Schema.Json))
const decodeJsonLine = Schema.decodeUnknownEffect(Schema.fromJsonString(Schema.Json))
const isJsonObject = Schema.is(Schema.JsonObject)

export type CopilotAcpRequest = {
	readonly method: string
	readonly params: Json
}

// The live ACP-over-stdio connection, and the only thing Session.ts and
// Adapter.ts know about the transport. `notifications` carries every inbound
// line that is not the answer to a request Acepe sent, which is both the
// agent's session/update notifications AND its own requests (a permission
// prompt above all) — `reply` is how those get answered.
export type CopilotAcpHandle = {
	readonly notifications: Stream.Stream<Json, ProviderAdapterError>
	readonly request: (
		method: string,
		params: Json
	) => Effect.Effect<Json, ProviderAdapterError>
	readonly notify: (method: string, params: Json) => Effect.Effect<void, ProviderAdapterError>
	readonly reply: (id: Json, result: Json) => Effect.Effect<void, ProviderAdapterError>
	readonly close: Effect.Effect<void>
}

type PendingRequest = {
	readonly method: string
	readonly deferred: Deferred.Deferred<Json, ProviderAdapterError>
}

type LivePending = Ref.Ref<HashMap.HashMap<string, PendingRequest>>

const errorDetail = <A>(cause: A, fallback: string): string => {
	if (Predicate.isError(cause) && Str.isNonEmpty(cause.message)) {
		return cause.message
	}
	return fallback
}

const parseRequestId = (value: Json): Option.Option<string> => {
	if (Predicate.isNumber(value)) {
		return Option.some(String(value))
	}
	if (Predicate.isString(value) && Str.isNonEmpty(Str.trim(value))) {
		return Option.some(value)
	}
	return Option.none()
}

// Every request still waiting on an answer fails at once, because the only
// thing that reaches here is the agent going away: an unresolved deferred
// would otherwise hold the calling fiber for the app's whole life.
const failPending = Effect.fn("CopilotAdapter.failPending")(function*(
	pending: LivePending,
	detail: string
) {
	const current = yield* Ref.getAndSet(pending, HashMap.empty<string, PendingRequest>())
	yield* Effect.forEach(
		HashMap.values(current),
		(entry) => Deferred.fail(entry.deferred, adapterError("startSession", detail)),
		{ discard: true }
	)
})

export const handleStdoutLine = Effect.fn("CopilotAdapter.handleStdoutLine")(function*(
	line: string,
	pending: LivePending,
	notifications: Queue.Queue<Json, Done>
) {
	const decoded = yield* decodeJsonLine(line).pipe(Effect.option)
	if (Option.isNone(decoded)) {
		// A line Copilot wrote that is not JSON is not a protocol message; the
		// CLI prints progress and warnings on the same descriptor. Dropping it
		// keeps the connection alive, where treating it as a protocol fault
		// would end a working session over a log line.
		return
	}
	const message = decoded.value
	if (isJsonObject(message) === false) {
		yield* Queue.offer(notifications, message)
		return
	}
	const id = Option.flatMap(field(message, "id"), parseRequestId)
	const hasResult = Option.isSome(field(message, "result"))
	const hasError = Option.isSome(field(message, "error"))
	if (Option.isSome(id) && (hasResult || hasError)) {
		const entry = yield* Ref.modify(pending, (current) =>
			[HashMap.get(current, id.value), HashMap.remove(current, id.value)] as const)
		if (Option.isSome(entry)) {
			if (hasError) {
				yield* Deferred.fail(
					entry.value.deferred,
					adapterError("sendPrompt", `Copilot ${entry.value.method} failed`)
				)
				return
			}
			const result = Option.getOrElse(field(message, "result"), () => EMPTY_JSON_OBJECT)
			yield* Deferred.succeed(entry.value.deferred, result)
			return
		}
	}
	yield* Queue.offer(notifications, message)
})

export type CopilotSpawnInput = {
	readonly cwd: string
	// The agent's configured environment, resolved once by ProviderBridge.
	// Passed with extendEnv so the child keeps everything it inherits and an
	// override only wins on a name collision.
	readonly envOverrides: AgentEnvOverrides
	readonly launch: CopilotLaunchConfig
	readonly spawner: ChildProcessSpawner.ChildProcessSpawner["Service"]
	readonly scope: Scope.Scope
}

// Spawns `copilot --acp --stdio` and frames newline-delimited JSON-RPC over
// its stdio, the same way Codex/Adapter.ts's liveCreateAppServer does for the
// Codex app-server. The ACP SDK's typed client is deliberately not used here:
// Copilot's adapter speaks raw method names and Json params (see
// CopilotAcpHandle above), so a typed client would only re-encode them.
export const liveCreateTransport = Effect.fn("CopilotAdapter.liveCreateTransport")(function*(
	input: CopilotSpawnInput
) {
	const outbound = yield* Queue.unbounded<string, Done>()
	const notifications = yield* Queue.unbounded<Json, Done>()
	const pending = yield* Ref.make(HashMap.empty<string, PendingRequest>())
	const requestId = yield* Ref.make(0)
	const stderrText = yield* Ref.make("")
	const child = yield* input.spawner
		.spawn(
			agentChildProcess(input.launch.command, input.launch.args, {
				cwd: input.cwd,
				envOverrides: input.envOverrides
			})
		)
		.pipe(
			Effect.provideService(Scope.Scope, input.scope),
			Effect.mapError((cause) =>
				adapterError("startSession", errorDetail(cause, "Failed to spawn the Copilot CLI"))
			)
		)
	yield* Stream.fromQueue(outbound).pipe(
		Stream.map((line) => `${line}\n`),
		Stream.encodeText,
		Stream.run(child.stdin),
		Effect.forkIn(input.scope, { startImmediately: true })
	)
	yield* child.stderr.pipe(
		Stream.decodeText,
		Stream.runForEach((chunk) => Ref.update(stderrText, (current) => `${current}${chunk}`)),
		Effect.forkIn(input.scope, { startImmediately: true })
	)
	yield* child.stdout.pipe(
		Stream.decodeText,
		Stream.splitLines,
		Stream.filter((line) => Str.isNonEmpty(Str.trim(line))),
		Stream.runForEach((line) => handleStdoutLine(line, pending, notifications).pipe(Effect.ignore)),
		Effect.ensuring(
			Effect.gen(function*() {
				const stderr = yield* Ref.get(stderrText)
				const reason = Str.isNonEmpty(Str.trim(stderr))
					? `Copilot CLI exited unexpectedly:\n${stderr}`
					: "Copilot CLI exited unexpectedly"
				yield* failPending(pending, reason)
				yield* Queue.end(notifications)
			})
		),
		Effect.forkIn(input.scope, { startImmediately: true })
	)
	const writeLine = Effect.fn("CopilotAdapter.writeLine")(function*(
		value: Json,
		operation: ProviderAdapterError["operation"]
	) {
		const line = yield* encodeJsonLine(value).pipe(
			Effect.mapError(() => adapterError(operation, "Copilot JSON-RPC payload was not JSON"))
		)
		yield* Queue.offer(outbound, line)
	})
	const request = (method: string, params: Json) =>
		Effect.gen(function*() {
			const id = yield* Ref.updateAndGet(requestId, (current) => current + 1)
			const deferred = yield* Deferred.make<Json, ProviderAdapterError>()
			yield* Ref.update(pending, (current) =>
				HashMap.set(current, String(id), { method, deferred }))
			// No timeout on purpose: session/prompt only answers when the turn
			// ends, which is minutes of real work, and a deadline there would
			// abandon a running turn. The stdout drain above fails every
			// pending request when the CLI goes away, which is the only case a
			// deadline would have covered.
			yield* writeLine({ jsonrpc: "2.0", id, method, params }, "sendPrompt")
			return yield* Deferred.await(deferred)
		})
	const notify = (method: string, params: Json) =>
		writeLine({ jsonrpc: "2.0", method, params }, "sendPrompt")
	const reply = (id: Json, result: Json) =>
		writeLine({ jsonrpc: "2.0", id, result }, "respondToPermission")
	const close = Effect.gen(function*() {
		yield* Queue.end(outbound).pipe(Effect.ignore)
		yield* child.kill().pipe(Effect.ignore)
		yield* failPending(pending, "Copilot client stopped")
		yield* Queue.end(notifications).pipe(Effect.ignore)
	}).pipe(Effect.asVoid)
	return {
		notifications: Stream.fromQueue(notifications),
		request,
		notify,
		reply,
		close
	} satisfies CopilotAcpHandle
})
