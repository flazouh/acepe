import * as Duration from "effect/Duration"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Predicate from "effect/Predicate"
import * as Result from "effect/Result"
import {
	PtyAdapter,
	type PtyExitEvent,
	type PtyProcess,
	type PtySignal,
	PtySpawnError,
	type PtySpawnInput
} from "../Services/PtyAdapter.ts"
import {
	closeFd,
	EAGAIN,
	EINTR,
	lastErrno,
	openPtyPair,
	PtyFfiError,
	readFd,
	setNonblock,
	setWinsizeSync,
	writeFd
} from "../ptyFfi.ts"

export const BUN_PTY_ADAPTER = "bun"

const causeMessage = (cause: {}): string => {
	if (Predicate.hasProperty(cause, "message") === true && Predicate.isString(cause.message) === true) {
		return cause.message
	}
	return "unknown failure"
}

const commandLine = (input: PtySpawnInput): Array<string> => {
	const cmd: Array<string> = [input.shell]
	for (const arg of input.args) {
		cmd.push(arg)
	}
	return cmd
}

const toSpawnError = (input: PtySpawnInput, error: PtyFfiError): PtySpawnError =>
	new PtySpawnError({
		adapter: BUN_PTY_ADAPTER,
		shell: input.shell,
		detail: error.message
	})

const writeAll = (fd: number, bytes: Uint8Array): void => {
	let offset = 0
	while (offset < bytes.byteLength) {
		const n = writeFd(fd, bytes.subarray(offset))
		if (n < 0) {
			const err = lastErrno()
			if (err === EINTR) {
				continue
			}
			throw new Error(`PTY write failed (errno ${err})`)
		}
		if (n === 0) {
			throw new Error("PTY write returned 0")
		}
		offset = offset + n
	}
}

const pumpMaster = Effect.fn("BunPtyAdapter.pump")(function*(
	master: number,
	emitData: (data: string) => void,
	closeMaster: () => void,
	isOpen: () => boolean
) {
	const decoder = new TextDecoder()
	const buffer = new Uint8Array(4096)
	while (isOpen() === true) {
		const n = readFd(master, buffer)
		if (n > 0) {
			emitData(decoder.decode(buffer.subarray(0, n), { stream: true }))
			continue
		}
		if (n === 0) {
			closeMaster()
			return
		}
		const err = lastErrno()
		if (err === EAGAIN || err === EINTR) {
			yield* Effect.sleep(Duration.millis(8))
			continue
		}
		closeMaster()
		return
	}
})

const spawnPty = Effect.fn("BunPtyAdapter.spawn")(function*(input: PtySpawnInput) {
	const pair = yield* openPtyPair({
		cols: input.cols,
		rows: input.rows
	}).pipe(Effect.mapError((error) => toSpawnError(input, error)))
	const nonblock = yield* Effect.result(
		setNonblock(pair.master).pipe(Effect.mapError((error) => toSpawnError(input, error)))
	)
	if (Result.isFailure(nonblock) === true) {
		closeFd(pair.master)
		closeFd(pair.slave)
		return yield* nonblock.failure
	}
	let dataCb: ((data: string) => void) | undefined
	let exitCb: ((event: PtyExitEvent) => void) | undefined
	const pendingData: Array<string> = []
	let pendingExit: PtyExitEvent | undefined
	let masterOpen = true
	const emitData = (data: string): void => {
		if (dataCb !== undefined) {
			dataCb(data)
			return
		}
		pendingData.push(data)
	}
	const emitExit = (event: PtyExitEvent): void => {
		if (exitCb !== undefined) {
			exitCb(event)
			return
		}
		pendingExit = event
	}
	const closeMaster = (): void => {
		if (masterOpen === false) {
			return
		}
		masterOpen = false
		closeFd(pair.master)
	}
	const proc = yield* Effect.try({
		try: () =>
			Bun.spawn({
				cmd: commandLine(input),
				cwd: input.cwd,
				env: input.env,
				stdin: pair.slave,
				stdout: pair.slave,
				stderr: pair.slave,
				detached: true,
				onExit: (_subprocess, exitCode, signalCode) => {
					emitExit({
						exitCode: exitCode === null ? 0 : exitCode,
						signal: signalCode
					})
				}
			}),
		catch: (cause) => {
			closeFd(pair.master)
			closeFd(pair.slave)
			return new PtySpawnError({
				adapter: BUN_PTY_ADAPTER,
				shell: input.shell,
				detail: Predicate.isObject(cause) === true ? causeMessage(cause) : "unknown failure"
			})
		}
	})
	closeFd(pair.slave)
	yield* pumpMaster(pair.master, emitData, closeMaster, () => masterOpen === true).pipe(
		Effect.forkDetach({ startImmediately: true })
	)
	const encoder = new TextEncoder()
	return {
		pid: proc.pid,
		write: (data: string) => {
			writeAll(pair.master, encoder.encode(data))
		},
		resize: (cols: number, rows: number) => {
			const rc = setWinsizeSync(pair.master, { cols, rows })
			if (rc !== 0) {
				throw new Error(`TIOCSWINSZ failed (errno ${lastErrno()})`)
			}
		},
		kill: (signal?: PtySignal) => {
			if (signal === undefined) {
				proc.kill()
				return
			}
			proc.kill(signal)
		},
		onData: (callback: (data: string) => void) => {
			dataCb = callback
			for (const chunk of pendingData) {
				callback(chunk)
			}
			pendingData.length = 0
			return () => {
				dataCb = undefined
			}
		},
		onExit: (callback: (event: PtyExitEvent) => void) => {
			exitCb = callback
			if (pendingExit !== undefined) {
				callback(pendingExit)
				pendingExit = undefined
			}
			return () => {
				exitCb = undefined
			}
		}
	} satisfies PtyProcess
})

export const BunPtyAdapterLive = Layer.succeed(
	PtyAdapter,
	PtyAdapter.of({
		spawn: spawnPty
	})
)
