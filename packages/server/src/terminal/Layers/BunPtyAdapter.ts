import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Predicate from "effect/Predicate"
import {
	PtyAdapter,
	type PtyExitEvent,
	type PtyProcess,
	type PtySignal,
	PtySpawnError,
	type PtySpawnInput
} from "../Services/PtyAdapter.ts"
import { DEFAULT_TERM } from "../shellEnv.ts"

export const BUN_PTY_ADAPTER = "bun"

const causeMessage = (cause: {}): string => {
	if (Predicate.hasProperty(cause, "message") === true && Predicate.isString(cause.message) === true) {
		return cause.message
	}
	return "unknown failure"
}

const SIGNAL_BY_NAME: { readonly [key: string]: number } = {
	SIGHUP: 1,
	SIGINT: 2,
	SIGKILL: 9,
	SIGTERM: 15
}

const signalFromName = (name: string | null): number | null => {
	if (name === null) {
		return null
	}
	const mapped = SIGNAL_BY_NAME[name]
	if (mapped === undefined) {
		return null
	}
	return mapped
}

const commandLine = (input: PtySpawnInput): Array<string> => {
	const cmd: Array<string> = [input.shell]
	for (const arg of input.args) {
		cmd.push(arg)
	}
	return cmd
}

const openBunPty = (input: PtySpawnInput): PtyProcess => {
	const decoder = new TextDecoder()
	let dataCb: ((data: string) => void) | undefined
	let exitCb: ((event: PtyExitEvent) => void) | undefined
	const pendingData: Array<string> = []
	let pendingExit: PtyExitEvent | undefined
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
	const proc = Bun.spawn({
		cmd: commandLine(input),
		cwd: input.cwd,
		env: input.env,
		terminal: {
			cols: input.cols,
			rows: input.rows,
			name: DEFAULT_TERM,
			data: (_terminal, chunk) => {
				emitData(decoder.decode(chunk, { stream: true }))
			}
		},
		onExit: (subprocess, exitCode) => {
			const term = subprocess.terminal
			if (term !== undefined && term.closed === false) {
				term.close()
			}
			emitExit({
				exitCode: exitCode === null ? 0 : exitCode,
				signal: signalFromName(subprocess.signalCode)
			})
		}
	})
	const terminal = proc.terminal
	if (terminal === undefined) {
		proc.kill("SIGKILL")
		throw new Error("Bun.spawn did not attach a PTY")
	}
	return {
		pid: proc.pid,
		write: (data: string) => {
			terminal.write(data)
		},
		resize: (cols: number, rows: number) => {
			terminal.resize(cols, rows)
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
	}
}

const spawnPty = Effect.fn("BunPtyAdapter.spawn")((input: PtySpawnInput) =>
	Effect.try({
		try: () => openBunPty(input),
		catch: (cause) =>
			new PtySpawnError({
				adapter: BUN_PTY_ADAPTER,
				shell: input.shell,
				detail: Predicate.isObject(cause) === true ? causeMessage(cause) : "unknown failure"
			})
	})
)

export const BunPtyAdapterLive = Layer.succeed(
	PtyAdapter,
	PtyAdapter.of({
		spawn: spawnPty
	})
)
