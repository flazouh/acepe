import * as Duration from "effect/Duration"
import * as Effect from "effect/Effect"

import {
	type QaAppNotRunning,
	type QaEvalFailed,
	type QaEvalTimeout,
	QaElementNotFound,
	type QaSocketError,
	QaUnknownCommand,
	QaWindowNotFound,
} from "../errors.ts"
import { handleQaMethod, type MemoryPage } from "../preload/qa-preload.ts"
import { type QaBridgeClientShape } from "./bridge-client.ts"
import { formatDoctorOk, QaSocketRequest, QaWindowInfo } from "./protocol.ts"

export type QaTransportError = QaAppNotRunning | QaSocketError

export type QaCallError = QaWindowNotFound | QaElementNotFound | QaEvalTimeout | QaEvalFailed | QaTransportError

export type QaSocketHandlerError = QaCallError | QaUnknownCommand

export type QaSession = {
	readonly doctor: () => Effect.Effect<string, QaWindowNotFound | QaTransportError>
	readonly listWindows: () => Effect.Effect<ReadonlyArray<QaWindowInfo>, QaTransportError>
	readonly firstWindow: () => Effect.Effect<QaWindowInfo, QaWindowNotFound | QaTransportError>
	readonly useWindow: (windowId: string) => Effect.Effect<QaWindowInfo, QaWindowNotFound | QaTransportError>
	readonly windowInfo: () => Effect.Effect<QaWindowInfo, QaWindowNotFound | QaTransportError>
	readonly call: (
		method: string,
		params: unknown,
		deadline?: Duration.Duration,
	) => Effect.Effect<unknown, QaCallError>
	readonly handleSocketRequest: (
		request: QaSocketRequest,
	) => Effect.Effect<unknown, QaSocketHandlerError>
}

export type QaSessionInput = {
	readonly windows: ReadonlyArray<QaWindowInfo>
	readonly client: QaBridgeClientShape
	readonly memoryPage?: MemoryPage
}

const SOCKET_TO_QA: Record<string, string> = {
	snapshotText: "qa:snapshotText",
	snapshotDom: "qa:snapshotDom",
	pageInfo: "qa:pageInfo",
	click: "qa:click",
	typeText: "qa:type",
	pressKey: "qa:key",
	scrollBy: "qa:scroll",
	waitForText: "qa:waitFor",
	js: "qa:eval",
}

const queryLabel = (params: unknown): string => {
	if (params !== null && typeof params === "object" && "text" in params) {
		const text = params.text
		if (typeof text === "string") {
			return `text=${text}`
		}
	}
	if (params !== null && typeof params === "object" && "selector" in params) {
		const selector = params.selector
		if (typeof selector === "string") {
			return `selector=${selector}`
		}
	}
	return "target"
}

const requireWindow = (
	windows: ReadonlyArray<QaWindowInfo>,
	windowId: string,
): Effect.Effect<QaWindowInfo, QaWindowNotFound> => {
	for (const window of windows) {
		if (window.id === windowId) {
			return Effect.succeed(window)
		}
	}
	return new QaWindowNotFound({ windowId })
}

const firstOf = (
	windows: ReadonlyArray<QaWindowInfo>,
): Effect.Effect<QaWindowInfo, QaWindowNotFound> => {
	const first = windows[0]
	if (first === undefined) {
		return new QaWindowNotFound({ windowId: "none" })
	}
	return Effect.succeed(first)
}

const windowIdFromParams = (params: unknown): string => {
	if (params !== null && typeof params === "object" && "id" in params) {
		const id = params.id
		if (typeof id === "string") {
			return id
		}
	}
	return ""
}

const requestThroughClient = (
	client: QaBridgeClientShape,
	method: string,
	params: unknown,
	deadline: Duration.Duration | undefined,
): Effect.Effect<unknown, QaEvalTimeout | QaEvalFailed> => {
	if (deadline === undefined) {
		return client.request({ method, params })
	}
	return client.request({ method, params }, deadline)
}

export const makeQaSession = (input: QaSessionInput): QaSession => {
	let currentId = input.windows[0]?.id ?? "none"
	const doctor = Effect.fn("QaSession.doctor")(function* () {
		const window = yield* requireWindow(input.windows, currentId).pipe(
			Effect.catchTag("QaWindowNotFound", () => firstOf(input.windows)),
		)
		return formatDoctorOk({
			title: window.title,
			url: window.url,
			windows: input.windows.length,
		})
	})
	const listWindows = () => Effect.succeed(input.windows)
	const firstWindow = Effect.fn("QaSession.firstWindow")(function* () {
		return yield* firstOf(input.windows)
	})
	const useWindow = Effect.fn("QaSession.useWindow")(function* (windowId: string) {
		const window = yield* requireWindow(input.windows, windowId)
		currentId = window.id
		return window
	})
	const windowInfo = Effect.fn("QaSession.windowInfo")(function* () {
		return yield* requireWindow(input.windows, currentId)
	})
	const call = Effect.fn("QaSession.call")(function* (
		method: string,
		params: unknown,
		deadline?: Duration.Duration,
	) {
		const result =
			input.memoryPage === undefined
				? yield* requestThroughClient(input.client, method, params, deadline)
				: handleQaMethod(input.memoryPage, method, params)
		if ((method === "qa:click" || method === "qa:waitFor") && result === false) {
			return yield* new QaElementNotFound({ query: queryLabel(params) })
		}
		return result
	})
	const callMapped = Effect.fn("QaSession.callMapped")(function* (
		method: string,
		params: unknown,
	) {
		if (method.startsWith("qa:") === true) {
			return yield* call(method, params)
		}
		const mapped = SOCKET_TO_QA[method]
		if (mapped === undefined) {
			return yield* new QaUnknownCommand({ command: method })
		}
		return yield* call(mapped, params)
	})
	const handleSocketRequest = Effect.fn("QaSession.handleSocketRequest")(function* (
		request: QaSocketRequest,
	) {
		if (request.method === "doctor") {
			return yield* doctor()
		}
		if (request.method === "listWindows") {
			return yield* listWindows()
		}
		if (request.method === "firstWindow") {
			return yield* firstWindow()
		}
		if (request.method === "windowInfo") {
			return yield* windowInfo()
		}
		if (request.method === "useWindow") {
			return yield* useWindow(windowIdFromParams(request.params))
		}
		const params = request.params === undefined ? {} : request.params
		return yield* callMapped(request.method, params)
	})
	return {
		doctor,
		listWindows,
		firstWindow,
		useWindow,
		windowInfo,
		call,
		handleSocketRequest,
	}
}
