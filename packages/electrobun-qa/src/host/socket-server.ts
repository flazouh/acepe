import * as Duration from "effect/Duration"
import * as Effect from "effect/Effect"
import * as Schedule from "effect/Schedule"
import * as Result from "effect/Result"
import * as Schema from "effect/Schema"

import {
	QaAppNotRunning,
	QaResponseTimeout,
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

/**
 * One decoder per connection, decoding in streaming mode.
 *
 * A fresh `TextDecoder` per chunk destroys any character whose bytes land on a
 * chunk boundary, which a transcript full of accented text and emoji hits as
 * soon as a payload is large enough to arrive in pieces. Streaming mode holds
 * the partial character until its remaining bytes arrive.
 */
const makeChunkDecoder = (): ((data: string | Uint8Array) => string) => {
	const decoder = new TextDecoder("utf-8")
	return (data) => (typeof data === "string" ? data : decoder.decode(data, { stream: true }))
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

/**
 * Bun's `socket.write` returns how many bytes it took, and it takes fewer than
 * asked whenever the send buffer is full. Ignoring that number truncates every
 * response larger than the buffer: the client never sees the terminating
 * newline and waits out its whole deadline for a reply that was already sent in
 * part. A `snapshotDom` of a busy page and a capture of a real session are both
 * comfortably over the line, so the remainder is held and flushed on `drain`.
 */
type WritableSocket = {
	readonly write: (data: Uint8Array) => number
}

const encoder = new TextEncoder()

const concatBytes = (left: Uint8Array, right: Uint8Array): Uint8Array => {
	const joined = new Uint8Array(left.length + right.length)
	joined.set(left, 0)
	joined.set(right, left.length)
	return joined
}

/**
 * The remainder is tracked in bytes, not characters. `write` reports bytes
 * taken, and one character of the transcript content a capture carries can be
 * several of them, so slicing a string by that count corrupts the stream into
 * something that is no longer JSON.
 */
const flushPending = (
	socket: WritableSocket,
	pending: WeakMap<WritableSocket, Uint8Array>,
): void => {
	const outstanding = pending.get(socket)
	if (outstanding === undefined || outstanding.length === 0) {
		return
	}
	const written = socket.write(outstanding)
	pending.set(
		socket,
		written >= outstanding.length ? new Uint8Array(0) : outstanding.slice(written),
	)
}

const writeLine = (
	socket: WritableSocket,
	pending: WeakMap<WritableSocket, Uint8Array>,
	line: string,
): void => {
	const queued = pending.get(socket) ?? new Uint8Array(0)
	pending.set(socket, concatBytes(queued, encoder.encode(line)))
	flushPending(socket, pending)
}

export const startQaHostUnsafe = (input: StartQaHostInput): StartedQaHost => {
	ensureSocketDir(input.path)
	removeStaleSocket(input.path)
	const buffers = new WeakMap<WritableSocket, string>()
	const decoders = new WeakMap<WritableSocket, (data: string | Uint8Array) => string>()
	const pendingWrites = new WeakMap<WritableSocket, Uint8Array>()
	const server = Bun.listen({
		unix: input.path,
		socket: {
			data: (socket, data) => {
				let decode = decoders.get(socket)
				if (decode === undefined) {
					decode = makeChunkDecoder()
					decoders.set(socket, decode)
				}
				const previous = buffers.get(socket) ?? ""
				const next = `${previous}${decode(data)}`
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
									writeLine(socket, pendingWrites, `${response}\n`)
								}),
							),
						),
					)
				}
			},
			drain: (socket) => {
				flushPending(socket, pendingWrites)
			},
			// A client that dies mid-script must not wedge the listener: drop
			// its buffer and keep accepting. Without these, one dead client left
			// the socket answering doctor but refusing run.
			error: (socket) => {
				buffers.delete(socket)
				decoders.delete(socket)
				pendingWrites.delete(socket)
			},
			close: (socket) => {
				buffers.delete(socket)
				decoders.delete(socket)
				pendingWrites.delete(socket)
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

// Shared with the connect attempt below so the outer deadline can tell a
// slow-to-answer app (connection opened) apart from a genuinely absent one
// (connection never opened). Reset at the start of each connect attempt, so
// a retried attempt reports its own state, not a stale one.
type ConnectionState = { opened: boolean }

export const sendSocketRequest = Effect.fn("sendSocketRequest")(function* (
	path: string,
	request: QaSocketRequest,
	deadline: Duration.Duration,
) {
	const line = yield* Schema.encodeUnknownEffect(QaSocketRequestLine)(request).pipe(
		Effect.mapError(asSocketError),
	)
	const state: ConnectionState = { opened: false }
	// The deadline firing while the connection is open means the app is there
	// and slow, not absent - a response timeout, not QaAppNotRunning. This is
	// a single attempt with no retry: the request may already have run on the
	// host, and retrying here could re-execute it (e.g. double-click).
	const onDeadline = (): Effect.Effect<never, QaAppNotRunning | QaResponseTimeout> =>
		state.opened === true
			? Effect.fail(
					new QaResponseTimeout({
						path,
						method: request.method,
						deadlineMs: Duration.toMillis(deadline),
					}),
				)
			: Effect.fail(new QaAppNotRunning({ path }))
	const responseLine = yield* writeAndReadUnix(path, line, state).pipe(
		Effect.timeoutOrElse({
			duration: deadline,
			orElse: onDeadline,
		}),
	)
	return yield* Schema.decodeUnknownEffect(QaSocketResponseLine)(responseLine).pipe(
		Effect.mapError(asSocketError),
	)
})

const writeAndReadUnixOnce = (
	path: string,
	line: string,
	state: ConnectionState,
): Effect.Effect<string, QaAppNotRunning> =>
	Effect.callback<string, QaAppNotRunning>((resume) => {
		let settled = false
		let buffer = ""
		const decode = makeChunkDecoder()
		state.opened = false
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
					state.opened = true
					socket.write(`${line}\n`)
				},
				data: (socket, data) => {
					buffer = `${buffer}${decode(data)}`
					if (buffer.includes("\n") === true) {
						const response = buffer.split("\n")[0] ?? ""
						socket.end()
						finish(Effect.succeed(response))
					}
				},
				error: () => {
					finish(new QaAppNotRunning({ path, retriable: state.opened }))
				},
				connectError: () => {
					finish(new QaAppNotRunning({ path }))
				},
				close: () => {
					if (buffer.length === 0) {
						finish(new QaAppNotRunning({ path, retriable: state.opened }))
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

// One transient socket error must not fail a whole script: a client that
// reconnects immediately succeeds, so retry briefly before giving up. This
// retry only ever sees a connect-level QaAppNotRunning (opened then broke)
// from a completed attempt - the outer deadline in sendSocketRequest races
// this whole thing from the outside and is never subject to this retry, so
// a QaResponseTimeout is never retried here either.
const writeAndReadUnix = (
	path: string,
	line: string,
	state: ConnectionState,
): Effect.Effect<string, QaAppNotRunning> =>
	writeAndReadUnixOnce(path, line, state).pipe(
		Effect.retry({
			times: 2,
			schedule: Schedule.spaced(Duration.millis(300)),
			while: (failure) => failure.retriable === true,
		}),
	)

export const makeRemoteSession = (path: string): QaSession => {
	let token = 0
	const nextId = (): string => {
		token += 1
		return String(token)
	}
	// The deadline is per call, not per session: a DOM read on an idle app and a
	// capture that shares the bridge with an event replay burst do not belong on
	// the same clock. Callers that pass one get it; everyone else gets the
	// default.
	const rpc = Effect.fn("remoteRpc")(function* (
		method: string,
		params?: unknown,
		deadline?: Duration.Duration,
	) {
		const request =
			params === undefined
				? QaSocketRequest.make({ id: nextId(), method })
				: QaSocketRequest.make({ id: nextId(), method, params })
		const response = yield* sendSocketRequest(
			path,
			request,
			deadline === undefined ? DEFAULT_HELPER_DEADLINE : deadline,
		)
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
		call: Effect.fn("remoteCall")(function* (
			method: string,
			params: unknown,
			deadline?: Duration.Duration,
		) {
			return yield* rpc(method, params, deadline)
		}),
		handleSocketRequest: Effect.fn("remoteHandleSocketRequest")(function* (
			request: QaSocketRequest,
		) {
			return yield* rpc(request.method, request.params)
		}),
	}
}
