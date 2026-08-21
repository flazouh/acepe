import * as Duration from "effect/Duration"
import * as Effect from "effect/Effect"
import * as Result from "effect/Result"
import * as Schema from "effect/Schema"

import {
	QaAppNotRunning,
	QaSignedBuild,
	QaSocketError,
} from "../errors.ts"
import { DEFAULT_HELPER_DEADLINE } from "./bridge-client.ts"
import {
	QaSocketErr,
	QaSocketErrLine,
	QaSocketOk,
	QaSocketOkLine,
	QaSocketRequest,
	QaSocketRequestLine,
	QaSocketResponseLine,
	QaWindowInfo,
	QaWindowInfoList,
} from "./protocol.ts"
import { type QaSession } from "./session.ts"

export type StartedQaHost = {
	readonly path: string
	readonly stop: () => void
}

export type StartQaHostInput = {
	readonly signed: boolean
	readonly path: string
	readonly session: QaSession
}

const parentDir = (path: string): string => {
	const index = path.lastIndexOf("/")
	if (index <= 0) {
		return path
	}
	return path.slice(0, index)
}

const decodeChunk = (data: string | Uint8Array): string => {
	if (typeof data === "string") {
		return data
	}
	return new TextDecoder().decode(data)
}

const ensureSocketDir = (path: string): void => {
	Bun.spawnSync(["mkdir", "-p", parentDir(path)])
}

const removeStaleSocket = (path: string): void => {
	const result = Bun.spawnSync(["rm", "-f", path])
	if (result.exitCode !== 0) {
		return
	}
}

const encodeErrorLine = Effect.fn("encodeErrorLine")(function* (
	id: string,
	error: { readonly _tag: string; readonly message: string },
) {
	return yield* Schema.encodeUnknownEffect(QaSocketErrLine)(
		QaSocketErr.make({
			id,
			ok: false,
			error: {
				_tag: error._tag,
				message: error.message,
			},
		}),
	)
})

const encodeOkLine = Effect.fn("encodeOkLine")(function* (id: string, value: unknown) {
	return yield* Schema.encodeUnknownEffect(QaSocketOkLine)(
		QaSocketOk.make({
			id,
			ok: true,
			value,
		}),
	)
})

export const handleSocketLine = Effect.fn("handleSocketLine")(function* (
	session: QaSession,
	line: string,
) {
	const parsed = yield* Effect.result(Schema.decodeUnknownEffect(QaSocketRequestLine)(line))
	if (Result.isFailure(parsed) === true) {
		return yield* encodeErrorLine("0", {
			_tag: "QaSocketError",
			message: "invalid request",
		})
	}
	const request = parsed.success
	const handled = yield* Effect.result(session.handleSocketRequest(request))
	if (Result.isFailure(handled) === true) {
		return yield* encodeErrorLine(request.id, {
			_tag: handled.failure._tag,
			message: handled.failure.message,
		})
	}
	return yield* encodeOkLine(request.id, handled.success)
})

export const startQaHostUnsafe = (input: StartQaHostInput): StartedQaHost => {
	ensureSocketDir(input.path)
	removeStaleSocket(input.path)
	const buffers = new WeakMap<{ write: (data: string) => void }, string>()
	const server = Bun.listen({
		unix: input.path,
		socket: {
			data: (socket, data) => {
				const previous = buffers.get(socket) ?? ""
				const next = `${previous}${decodeChunk(data)}`
				const parts = next.split("\n")
				const rest = parts.pop() ?? ""
				buffers.set(socket, rest)
				for (const part of parts) {
					if (part.length === 0) {
						continue
					}
					Effect.runFork(
						handleSocketLine(input.session, part).pipe(
							Effect.tap((response) =>
								Effect.sync(() => {
									socket.write(`${response}\n`)
								}),
							),
						),
					)
				}
			},
		},
	})
	return {
		path: input.path,
		stop: () => {
			server.stop(true)
			removeStaleSocket(input.path)
		},
	}
}

export const startQaHost = Effect.fn("startQaHost")(function* (input: StartQaHostInput) {
	if (input.signed === true) {
		return yield* new QaSignedBuild({
			reason: "QA host is absent from a signed build",
		})
	}
	return yield* Effect.acquireRelease(
		Effect.try({
			try: () => startQaHostUnsafe(input),
			catch: (cause) => new QaSocketError({ reason: String(cause) }),
		}),
		(host) =>
			Effect.sync(() => {
				host.stop()
			}),
	)
})

const asSocketError = (error: { readonly message: string }): QaSocketError =>
	new QaSocketError({ reason: error.message })

export const sendSocketRequest = Effect.fn("sendSocketRequest")(function* (
	path: string,
	request: QaSocketRequest,
	deadline: Duration.Duration,
) {
	const line = yield* Schema.encodeUnknownEffect(QaSocketRequestLine)(request).pipe(
		Effect.mapError(asSocketError),
	)
	const responseLine = yield* writeAndReadUnix(path, line).pipe(
		Effect.timeoutOrElse({
			duration: deadline,
			orElse: () => new QaAppNotRunning({ path }),
		}),
	)
	return yield* Schema.decodeUnknownEffect(QaSocketResponseLine)(responseLine).pipe(
		Effect.mapError(asSocketError),
	)
})

const writeAndReadUnix = (path: string, line: string): Effect.Effect<string, QaAppNotRunning> =>
	Effect.callback<string, QaAppNotRunning>((resume) => {
		let settled = false
		let buffer = ""
		const finish = (effect: Effect.Effect<string, QaAppNotRunning>): void => {
			if (settled === true) {
				return
			}
			settled = true
			resume(effect)
		}
		const pending = Bun.connect({
			unix: path,
			socket: {
				open: (socket) => {
					socket.write(`${line}\n`)
				},
				data: (socket, data) => {
					buffer = `${buffer}${decodeChunk(data)}`
					if (buffer.includes("\n") === true) {
						const response = buffer.split("\n")[0] ?? ""
						socket.end()
						finish(Effect.succeed(response))
					}
				},
				error: () => {
					finish(new QaAppNotRunning({ path }))
				},
				connectError: () => {
					finish(new QaAppNotRunning({ path }))
				},
				close: () => {
					if (buffer.length === 0) {
						finish(new QaAppNotRunning({ path }))
					}
				},
			},
		})
		pending.then(
			() => undefined,
			() => {
				finish(new QaAppNotRunning({ path }))
			},
		)
	})

export const makeRemoteSession = (path: string): QaSession => {
	let token = 0
	const nextId = (): string => {
		token += 1
		return String(token)
	}
	const rpc = Effect.fn("remoteRpc")(function* (method: string, params?: unknown) {
		const request =
			params === undefined
				? QaSocketRequest.make({ id: nextId(), method })
				: QaSocketRequest.make({ id: nextId(), method, params })
		const response = yield* sendSocketRequest(path, request, DEFAULT_HELPER_DEADLINE)
		if (response.ok === true) {
			return response.value
		}
		return yield* new QaSocketError({ reason: response.error.message })
	})
	const decodeWindow = (value: unknown) =>
		Schema.decodeUnknownEffect(QaWindowInfo)(value).pipe(Effect.mapError(asSocketError))
	return {
		doctor: Effect.fn("remoteDoctor")(function* () {
			return String(yield* rpc("doctor"))
		}),
		listWindows: Effect.fn("remoteListWindows")(function* () {
			const value = yield* rpc("listWindows")
			return yield* Schema.decodeUnknownEffect(QaWindowInfoList)(value).pipe(
				Effect.mapError(asSocketError),
			)
		}),
		firstWindow: Effect.fn("remoteFirstWindow")(function* () {
			const value = yield* rpc("firstWindow")
			return yield* decodeWindow(value)
		}),
		useWindow: Effect.fn("remoteUseWindow")(function* (windowId: string) {
			const value = yield* rpc("useWindow", { id: windowId })
			return yield* decodeWindow(value)
		}),
		windowInfo: Effect.fn("remoteWindowInfo")(function* () {
			const value = yield* rpc("windowInfo")
			return yield* decodeWindow(value)
		}),
		call: Effect.fn("remoteCall")(function* (method: string, params: unknown) {
			return yield* rpc(method, params)
		}),
		handleSocketRequest: Effect.fn("remoteHandleSocketRequest")(function* (
			request: QaSocketRequest,
		) {
			return yield* rpc(request.method, request.params)
		}),
	}
}
