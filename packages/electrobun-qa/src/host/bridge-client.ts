import * as Context from "effect/Context"
import * as Deferred from "effect/Deferred"
import * as Duration from "effect/Duration"
import * as Effect from "effect/Effect"
import * as Schema from "effect/Schema"

import { QaEvalFailed, QaEvalTimeout } from "../errors.ts"
import { qaDispatchJavascript, QA_RESULT_MESSAGE_ID } from "../preload/qa-preload.ts"
import { QaBridgeResult, QaDispatchRequestJson } from "./protocol.ts"

export const DEFAULT_HELPER_DEADLINE = Duration.millis(5_000)

export type QaBridgeRequest = {
	readonly method: string
	readonly params: unknown
}

export type QaResultPayload = {
	readonly id: string
	readonly success: boolean
	readonly payload: unknown
}

export type QaJavascriptSender = {
	readonly executeJavascript: (js: string) => void
}

export type QaTokenState = {
	next: number
}

export const createTokenState = (): QaTokenState => ({ next: 0 })

export const nextQaToken = (state: QaTokenState): string => {
	state.next += 1
	return `qa-${String(state.next)}`
}

export type QaBridgeClientShape = {
	readonly request: (
		input: QaBridgeRequest,
		deadline?: Duration.Duration,
	) => Effect.Effect<unknown, QaEvalTimeout | QaEvalFailed>
	readonly receiveResult: (payload: unknown) => Effect.Effect<void>
}

export class QaBridgeClient extends Context.Service<QaBridgeClient, QaBridgeClientShape>()(
	"electrobun-qa/host/bridge-client/QaBridgeClient",
) {}

type Pending = Deferred.Deferred<unknown, QaEvalFailed>

const failReason = (payload: unknown, token: string): string => {
	if (payload !== null && typeof payload === "object" && "reason" in payload) {
		const reason = payload.reason
		if (typeof reason === "string") {
			return reason
		}
	}
	if (payload !== null && typeof payload === "object" && "message" in payload) {
		const message = payload.message
		if (typeof message === "string") {
			return message
		}
	}
	return token
}

const readResult = (payload: unknown): QaResultPayload | null => {
	if (Schema.is(QaBridgeResult)(payload) === false) {
		return null
	}
	return payload
}

export const makeQaBridgeClient = (input: {
	readonly sender: QaJavascriptSender
	readonly tokens: QaTokenState
}): QaBridgeClientShape => {
	const pending = new Map<string, Pending>()
	const receiveResult = Effect.fn("QaBridgeClient.receiveResult")(function* (payload: unknown) {
		const result = readResult(payload)
		if (result === null) {
			return
		}
		const deferred = pending.get(result.id)
		if (deferred === undefined) {
			return
		}
		pending.delete(result.id)
		if (result.success === true) {
			yield* Deferred.succeed(deferred, result.payload)
			return
		}
		yield* Deferred.fail(deferred, new QaEvalFailed({ reason: failReason(result.payload, result.id) }))
	})
	const request = Effect.fn("QaBridgeClient.request")(function* (
		bridgeRequest: QaBridgeRequest,
		deadline?: Duration.Duration,
	) {
		const token = nextQaToken(input.tokens)
		const deferred = yield* Deferred.make<unknown, QaEvalFailed>()
		pending.set(token, deferred)
		const encoded = yield* Schema.encodeUnknownEffect(QaDispatchRequestJson)({
			type: "request",
			method: bridgeRequest.method,
			id: token,
			params: bridgeRequest.params,
		}).pipe(Effect.mapError((error) => new QaEvalFailed({ reason: error.message })))
		input.sender.executeJavascript(qaDispatchJavascript(encoded))
		const wait = Deferred.await(deferred).pipe(
			Effect.timeoutOrElse({
				duration: deadline ?? DEFAULT_HELPER_DEADLINE,
				orElse: () => {
					pending.delete(token)
					return new QaEvalTimeout({ token })
				},
			}),
		)
		return yield* wait
	})
	return {
		request,
		receiveResult,
	}
}

export const bindQaResultHandler = (
	handlers: {
		message: Record<string, (payload: unknown) => void>
	},
	receive: (payload: unknown) => void,
): void => {
	handlers.message[QA_RESULT_MESSAGE_ID] = receive
}
