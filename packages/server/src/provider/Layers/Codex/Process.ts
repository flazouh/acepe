import type { ProviderOperation } from "@acepe/contracts"
import type { Done } from "effect/Cause"
import * as Deferred from "effect/Deferred"
import * as Effect from "effect/Effect"
import * as HashMap from "effect/HashMap"
import * as Option from "effect/Option"
import * as Predicate from "effect/Predicate"
import * as Queue from "effect/Queue"
import * as Ref from "effect/Ref"
import * as Schema from "effect/Schema"
import * as Stream from "effect/Stream"
import * as Str from "effect/String"
import { ProviderAdapterError } from "../../Services/ProviderAdapter.ts"
import { EMPTY_JSON_OBJECT, field, type Json } from "../Json.ts"
import { adapterError } from "./Provider.ts"

const encodeJsonLine = Schema.encodeUnknownEffect(Schema.fromJsonString(Schema.Json))
const isJsonObject = Schema.is(Schema.JsonObject)

export type PendingRequest = {
	readonly operation: ProviderAdapterError["operation"]
	readonly deferred: Deferred.Deferred<Json, ProviderAdapterError>
}

export type CodexJsonRpcRequest = {
	readonly operation: ProviderAdapterError["operation"]
	readonly method: string
	readonly params: Json
}

// Acepe answers exactly two Codex-initiated requests: an approval and a
// question. A reply carries its own operation for the same reason a request
// does, taken from the canonical union so a renamed member breaks here rather
// than drifting. Adapter.ts used to write the literal "sendPrompt" for every
// reply, so an encode failure on a permission answer read as a failed prompt.
export type CodexReplyOperation = Extract<
	ProviderOperation,
	"respondToPermission" | "respondToQuestion"
>

export type CodexJsonRpcReply = {
	readonly operation: CodexReplyOperation
	readonly id: Json
	readonly result: Json
}

export type CodexAppServerHandle = {
	readonly notifications: Stream.Stream<Json, ProviderAdapterError>
	readonly request: (input: CodexJsonRpcRequest) => Effect.Effect<Json, ProviderAdapterError>
	readonly notify: (
		method: string,
		params: Option.Option<Json>
	) => Effect.Effect<void, ProviderAdapterError>
	readonly reply: (input: CodexJsonRpcReply) => Effect.Effect<void, ProviderAdapterError>
	readonly close: Effect.Effect<void>
}

export const errorDetail = <A>(cause: A, fallback: string): string => {
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

export const writeJsonLine = Effect.fn("CodexAdapter.writeJsonLine")(function*(
	outbound: Queue.Queue<string, Done>,
	value: Json,
	operation: ProviderAdapterError["operation"]
) {
	const line = yield* encodeJsonLine(value).pipe(
		Effect.mapError(() => adapterError(operation, "Codex JSON-RPC payload was not JSON"))
	)
	yield* Queue.offer(outbound, line)
})

export type LivePending = Ref.Ref<HashMap.HashMap<string, PendingRequest>>

export const failPending = Effect.fn("CodexAdapter.failPending")(function*(
	pending: LivePending,
	detail: string
) {
	const current = yield* Ref.get(pending)
	yield* Ref.set(pending, HashMap.empty())
	yield* Effect.forEach(
		HashMap.values(current),
		(entry) => Deferred.fail(entry.deferred, adapterError(entry.operation, detail)),
		{ discard: true }
	)
})

export const handleStdoutLine = Effect.fn("CodexAdapter.handleStdoutLine")(function*(
	line: string,
	pending: LivePending,
	notifications: Queue.Queue<Json, Done>
) {
	const decoded = yield* Schema.decodeUnknownEffect(Schema.fromJsonString(Schema.Json))(line).pipe(
		Effect.option
	)
	if (Option.isNone(decoded)) {
		const reason = `Received invalid JSON from codex app-server: ${line}`
		yield* failPending(pending, reason)
		yield* Queue.offer(notifications, {
			method: "error",
			params: {
				error: { message: reason }
			}
		})
		yield* Queue.end(notifications)
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
		const current = yield* Ref.get(pending)
		const entry = HashMap.get(current, id.value)
		if (Option.isSome(entry)) {
			yield* Ref.update(pending, (map) => HashMap.remove(map, id.value))
			if (hasError) {
				yield* Deferred.fail(
					entry.value.deferred,
					adapterError(entry.value.operation, `JSON-RPC error for id ${id.value}`)
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
