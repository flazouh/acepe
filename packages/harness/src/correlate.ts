import {
	decodeRequestLine,
	JsonRpcFailure,
	JsonRpcSuccess,
	SidecarNotification,
} from "@acepe/sidecar"
import * as Arr from "effect/Array"
import * as Effect from "effect/Effect"
import * as HashMap from "effect/HashMap"
import * as Option from "effect/Option"
import * as Predicate from "effect/Predicate"
import * as Ref from "effect/Ref"
import * as Schema from "effect/Schema"
import { decodeJsonLine } from "./fixture.ts"

export type CompletedExchange = {
	readonly command: string
	readonly payload: Schema.Json
	readonly response: Schema.Json
	readonly notifications: ReadonlyArray<Schema.Json>
}

export type OpenExchange = {
	readonly requestId: string | number
	readonly command: string
	readonly payload: Schema.Json
	readonly notifications: ReadonlyArray<Schema.Json>
}

export type CorrelatorState = {
	readonly openOrder: ReadonlyArray<string>
	readonly open: HashMap.HashMap<string, OpenExchange>
}

export const requestIdKey = (id: string | number): string =>
	Predicate.isNumber(id) ? `n:${String(id)}` : `s:${id}`

const emptyObject: Schema.Json = {}

const payloadFromParams = Effect.fn("payloadFromParams")((params: unknown) => {
	if (params === undefined) {
		return Effect.succeed(emptyObject)
	}
	return Schema.decodeUnknownEffect(Schema.Json)(params)
})

export const emptyCorrelatorState = (): CorrelatorState => ({
	openOrder: Arr.empty(),
	open: HashMap.empty(),
})

export const makeCorrelator = Effect.fn("makeCorrelator")(function* () {
	const state = yield* Ref.make(emptyCorrelatorState())
	return state
})

export const ingestAppLine = Effect.fn("ingestAppLine")(function* (
	state: Ref.Ref<CorrelatorState>,
	line: string,
) {
	const request = yield* decodeRequestLine(line)
	const payload = yield* payloadFromParams(request.params)
	const key = requestIdKey(request.id)
	yield* Ref.update(state, (current) => ({
		openOrder: Arr.append(current.openOrder, key),
		open: HashMap.set(current.open, key, {
			requestId: request.id,
			command: request.method,
			payload,
			notifications: Arr.empty(),
		}),
	}))
})

const decodeSidecarSuccess = Schema.decodeUnknownEffect(JsonRpcSuccess)
const decodeSidecarFailure = Schema.decodeUnknownEffect(JsonRpcFailure)
const decodeSidecarNotification = Schema.decodeUnknownEffect(SidecarNotification)

const completeExchange = Effect.fn("completeExchange")((
	state: Ref.Ref<CorrelatorState>,
	key: string,
	response: Schema.Json,
) =>
	Ref.modify(state, (current) => {
		const open = Option.getOrUndefined(HashMap.get(current.open, key))
		if (open === undefined) {
			return [Option.none(), current]
		}
		const completed: CompletedExchange = {
			command: open.command,
			payload: open.payload,
			response,
			notifications: open.notifications,
		}
		const next: CorrelatorState = {
			openOrder: Arr.filter(current.openOrder, (id) => id !== key),
			open: HashMap.remove(current.open, key),
		}
		return [Option.some(completed), next]
	}))

const appendNotification = Effect.fn("appendNotification")((
	state: Ref.Ref<CorrelatorState>,
	notification: Schema.Json,
) =>
	Ref.update(state, (current) => {
		const oldest = Option.getOrUndefined(Arr.head(current.openOrder))
		if (oldest === undefined) {
			return current
		}
		const open = Option.getOrUndefined(HashMap.get(current.open, oldest))
		if (open === undefined) {
			return current
		}
		return {
			openOrder: current.openOrder,
			open: HashMap.set(current.open, oldest, {
				requestId: open.requestId,
				command: open.command,
				payload: open.payload,
				notifications: Arr.append(open.notifications, notification),
			}),
		}
	}))

export const ingestSidecarLine = Effect.fn("ingestSidecarLine")(function* (
	state: Ref.Ref<CorrelatorState>,
	line: string,
) {
	const json = yield* decodeJsonLine(line)
	const asSuccess = yield* Effect.option(decodeSidecarSuccess(json))
	if (Option.isSome(asSuccess)) {
		const response = yield* Schema.decodeUnknownEffect(Schema.Json)(json)
		const completed = yield* completeExchange(state, requestIdKey(asSuccess.value.id), response)
		return completed
	}
	const asFailure = yield* Effect.option(decodeSidecarFailure(json))
	if (Option.isSome(asFailure) && asFailure.value.id !== null) {
		const response = yield* Schema.decodeUnknownEffect(Schema.Json)(json)
		const completed = yield* completeExchange(state, requestIdKey(asFailure.value.id), response)
		return completed
	}
	const asNotification = yield* Effect.option(decodeSidecarNotification(json))
	if (Option.isSome(asNotification)) {
		const notification = yield* Schema.decodeUnknownEffect(Schema.Json)(json)
		yield* appendNotification(state, notification)
		return Option.none()
	}
	return Option.none()
})
