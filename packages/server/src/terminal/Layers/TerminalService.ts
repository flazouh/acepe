import { SessionId } from "@acepe/contracts"
import * as Arr from "effect/Array"
import * as Config from "effect/Config"
import * as Crypto from "effect/Crypto"
import * as Deferred from "effect/Deferred"
import * as Duration from "effect/Duration"
import * as Effect from "effect/Effect"
import * as Fiber from "effect/Fiber"
import * as FileSystem from "effect/FileSystem"
import * as HashMap from "effect/HashMap"
import * as Layer from "effect/Layer"
import * as Option from "effect/Option"
import * as Predicate from "effect/Predicate"
import * as Rec from "effect/Record"
import * as Ref from "effect/Ref"
import * as Stream from "effect/Stream"
import * as SynchronizedRef from "effect/SynchronizedRef"
import * as ChildProcess from "effect/unstable/process/ChildProcess"
import * as ChildProcessSpawner from "effect/unstable/process/ChildProcessSpawner"
import {
	buildTerminalEnv,
	commandSpawnTarget,
	DEFAULT_COLS,
	DEFAULT_ROWS,
	DEFAULT_TERM,
	defaultCaptureShell,
	defaultShell,
	type EnvMap,
	envMapToRecord,
	enforceOutputLimit,
	interactiveSpawnTarget,
	isWindowsHost,
	parseEnvOutput,
	SHELL_ENV_CAPTURE_TIMEOUT_SECONDS,
	shellCaptureArgs,
	shellEnvPayload
} from "../shellEnv.ts"
import {
	PtyAdapter,
	type PtyExitEvent,
	type PtyProcess,
	type PtySignal
} from "../Services/PtyAdapter.ts"
import {
	type OpenTerminalInput,
	type TerminalCols,
	TerminalCwdNotDirectoryError,
	TerminalCwdNotFoundError,
	TerminalCwdStatError,
	type TerminalExitStatus,
	type TerminalHandle,
	TerminalId,
	TerminalNotRunningError,
	TerminalOpenError,
	type TerminalOutput,
	TerminalResizeError,
	type TerminalRows,
	TerminalService,
	TerminalSessionLookupError,
	TerminalSignalError,
	TerminalWriteError
} from "../Services/TerminalService.ts"

export type TerminalServiceLiveOptions = {
	readonly processKillGrace: Duration.Duration
	readonly loginEnv: Option.Option<EnvMap>
	readonly defaultShellOverride: Option.Option<string>
	readonly loginEnvCaptureTimeout: Duration.Duration
}

export const defaultTerminalServiceOptions: TerminalServiceLiveOptions = {
	processKillGrace: Duration.seconds(1),
	loginEnv: Option.none(),
	defaultShellOverride: Option.none(),
	loginEnvCaptureTimeout: Duration.seconds(SHELL_ENV_CAPTURE_TIMEOUT_SECONDS)
}

const causeMessage = (cause: {}): string => {
	if (Predicate.hasProperty(cause, "message") === true && Predicate.isString(cause.message) === true) {
		return cause.message
	}
	return "unknown failure"
}

const toExitStatus = (event: PtyExitEvent): TerminalExitStatus => ({
	exitCode: event.exitCode,
	signal: event.signal === null ? null : String(event.signal)
})

type OutputBuffer = {
	text: string
	truncated: boolean
}

type TerminalRecord = {
	readonly terminalId: TerminalId
	readonly sessionId: SessionId
	readonly shell: string
	readonly pty: PtyProcess
	readonly buffer: OutputBuffer
	readonly outputByteLimit: Option.Option<number>
	readonly exit: Deferred.Deferred<TerminalExitStatus>
	readonly running: { value: boolean }
	exitStatus: TerminalExitStatus | null
	disposeData: () => void
	disposeExit: () => void
}

const appendOutput = (record: TerminalRecord, chunk: string): void => {
	const next = `${record.buffer.text}${chunk}`
	if (Option.isNone(record.outputByteLimit)) {
		record.buffer.text = next
		return
	}
	const limited = enforceOutputLimit(next, record.outputByteLimit.value)
	record.buffer.text = limited.text
	if (limited.truncated === true) {
		record.buffer.truncated = true
	}
}

export const makeTerminalService = Effect.fn("TerminalService.make")(function*(
	options: TerminalServiceLiveOptions
) {
	const fs = yield* FileSystem.FileSystem
	const crypto = yield* Crypto.Crypto
	const spawner = yield* ChildProcessSpawner.ChildProcessSpawner
	const ptyAdapter = yield* PtyAdapter
	const terminals = yield* SynchronizedRef.make(HashMap.empty<TerminalId, TerminalRecord>())
	const cachedLoginEnv = yield* Ref.make(Option.none<EnvMap>())

	const envOption = (name: string) =>
		Config.option(Config.string(name)).pipe(Effect.orElseSucceed(() => Option.none<string>()))

	const comspecConfig = yield* envOption("COMSPEC")
	const shellConfig = yield* envOption("SHELL")
	const pathConfig = yield* envOption("PATH")

	const resolveDefaultShell = Effect.fn("TerminalService.resolveDefaultShell")(function*() {
		if (Option.isSome(options.defaultShellOverride)) {
			return options.defaultShellOverride.value
		}
		return defaultShell(comspecConfig, shellConfig)
	})

	const captureLoginShellEnv = Effect.fn("TerminalService.captureLoginShellEnv")(function*() {
		const shell = defaultCaptureShell(shellConfig)
		const exists = yield* fs.exists(shell).pipe(Effect.orElseSucceed(() => false))
		if (exists === false) {
			return Rec.empty<string, string>()
		}
		const args = shellCaptureArgs(shell)
		const stdout = yield* Effect.scoped(
			Effect.gen(function*() {
				const handle = yield* spawner.spawn(
					ChildProcess.make(shell, args, {
						env: {
							DISABLE_AUTO_UPDATE: "true",
							HOMEBREW_NO_AUTO_UPDATE: "1"
						},
						extendEnv: true,
						detached: false,
						stdin: "ignore",
						stderr: "ignore"
					})
				)
				const collector = yield* handle.stdout.pipe(
					Stream.decodeText,
					Stream.mkString,
					Effect.forkScoped({ startImmediately: true })
				)
				const finished = yield* handle.exitCode.pipe(
					Effect.timeout(options.loginEnvCaptureTimeout),
					Effect.option
				)
				if (Option.isNone(finished)) {
					yield* handle.kill({ killSignal: "SIGKILL" }).pipe(Effect.ignore)
					return Option.none<string>()
				}
				return yield* Fiber.join(collector).pipe(Effect.timeout(Duration.seconds(1)), Effect.option)
			})
		).pipe(Effect.orElseSucceed(() => Option.none<string>()))
		if (Option.isNone(stdout)) {
			return Rec.empty<string, string>()
		}
		return parseEnvOutput(shellEnvPayload(stdout.value))
	})

	const resolveLoginEnv = Effect.fn("TerminalService.resolveLoginEnv")(function*() {
		if (Option.isSome(options.loginEnv)) {
			return options.loginEnv.value
		}
		const cached = yield* Ref.get(cachedLoginEnv)
		if (Option.isSome(cached)) {
			return cached.value
		}
		const captured = yield* captureLoginShellEnv()
		yield* Ref.set(cachedLoginEnv, Option.some(captured))
		return captured
	})

	const requireRecord = Effect.fn("TerminalService.requireRecord")(function*(terminalId: TerminalId) {
		const record = HashMap.get(yield* SynchronizedRef.get(terminals), terminalId)
		if (Option.isNone(record)) {
			return yield* new TerminalSessionLookupError({ terminalId })
		}
		return record.value
	})

	const requireRunning = Effect.fn("TerminalService.requireRunning")(function*(terminalId: TerminalId) {
		const record = yield* requireRecord(terminalId)
		if (record.running.value === false) {
			return yield* new TerminalNotRunningError({ terminalId })
		}
		return record
	})

	const validateCwd = Effect.fn("TerminalService.validateCwd")(function*(cwd: string) {
		const exists = yield* fs.exists(cwd).pipe(
			Effect.mapError(
				(error) =>
					new TerminalCwdStatError({
						cwd,
						detail: error.message
					})
			)
		)
		if (exists === false) {
			return yield* new TerminalCwdNotFoundError({ cwd })
		}
		const info = yield* fs.stat(cwd).pipe(
			Effect.mapError(
				(error) =>
					new TerminalCwdStatError({
						cwd,
						detail: error.message
					})
			)
		)
		if (info.type !== "Directory") {
			return yield* new TerminalCwdNotDirectoryError({ cwd })
		}
	})

	const teardown = Effect.fn("TerminalService.teardown")(function*(record: TerminalRecord) {
		if (record.running.value === true) {
			yield* Effect.sync(() => {
				record.pty.kill("SIGTERM")
			}).pipe(Effect.ignore)
			const finished = yield* Deferred.await(record.exit).pipe(
				Effect.as(true),
				Effect.timeout(options.processKillGrace),
				Effect.option
			)
			if (Option.isNone(finished) && record.running.value === true) {
				yield* Effect.sync(() => {
					record.pty.kill("SIGKILL")
				}).pipe(Effect.ignore)
				yield* Deferred.await(record.exit).pipe(Effect.ignore)
			}
		}
		record.disposeData()
		record.disposeExit()
	})

	const open = Effect.fn("TerminalService.open")(function*(input: OpenTerminalInput) {
		yield* validateCwd(input.cwd)
		const resolvedShell =
			input.shell === undefined ? yield* resolveDefaultShell() : input.shell
		const windows = isWindowsHost(comspecConfig)
		const target =
			input.command === undefined
				? interactiveSpawnTarget(resolvedShell)
				: commandSpawnTarget(windows, input.command)
		const loginEnv = yield* resolveLoginEnv()
		const pathFallback = Option.getOrElse(pathConfig, () => "")
		const requestEnv = input.env === undefined ? Arr.empty<{ readonly name: string; readonly value: string }>() : input.env
		const env = envMapToRecord(
			buildTerminalEnv({
				loginEnv,
				requestEnv,
				pathFallback,
				term: DEFAULT_TERM
			})
		)
		const cols = input.cols === undefined ? DEFAULT_COLS : input.cols
		const rows = input.rows === undefined ? DEFAULT_ROWS : input.rows
		const uuid = yield* crypto.randomUUIDv4.pipe(
			Effect.mapError((error) => new TerminalOpenError({ detail: error.message }))
		)
		const terminalId = TerminalId.make(uuid)
		const pty = yield* ptyAdapter.spawn({
			shell: target.file,
			args: target.args,
			cwd: input.cwd,
			cols,
			rows,
			env
		})
		const exit = yield* Deferred.make<TerminalExitStatus>()
		const record: TerminalRecord = {
			terminalId,
			sessionId: input.sessionId,
			shell: target.file,
			pty,
			buffer: { text: "", truncated: false },
			outputByteLimit: Option.fromUndefinedOr(input.outputByteLimit),
			exit,
			running: { value: true },
			exitStatus: null,
			disposeData: () => undefined,
			disposeExit: () => undefined
		}
		record.disposeData = pty.onData((chunk) => {
			appendOutput(record, chunk)
		})
		record.disposeExit = pty.onExit((event) => {
			const status = toExitStatus(event)
			record.running.value = false
			record.exitStatus = status
			Deferred.doneUnsafe(exit, Effect.succeed(status))
		})
		yield* SynchronizedRef.update(terminals, (current) => HashMap.set(current, terminalId, record))
		return {
			terminalId,
			sessionId: input.sessionId,
			pid: pty.pid,
			shell: target.file
		} satisfies TerminalHandle
	})

	const write = Effect.fn("TerminalService.write")(function*(terminalId: TerminalId, data: string) {
		const record = yield* requireRunning(terminalId)
		yield* Effect.try({
			try: () => {
				record.pty.write(data)
			},
			catch: (cause) =>
				new TerminalWriteError({
					terminalId,
					pid: record.pty.pid,
					detail: Predicate.isObject(cause) === true ? causeMessage(cause) : "unknown failure"
				})
		})
	})

	const resize = Effect.fn("TerminalService.resize")(function*(
		terminalId: TerminalId,
		cols: TerminalCols,
		rows: TerminalRows
	) {
		const record = yield* requireRunning(terminalId)
		yield* Effect.try({
			try: () => {
				record.pty.resize(cols, rows)
			},
			catch: (cause) =>
				new TerminalResizeError({
					terminalId,
					pid: record.pty.pid,
					cols,
					rows,
					detail: Predicate.isObject(cause) === true ? causeMessage(cause) : "unknown failure"
				})
		})
	})

	const sendSignal = Effect.fn("TerminalService.signal")(function*(
		terminalId: TerminalId,
		signal: PtySignal
	) {
		const record = yield* requireRunning(terminalId)
		yield* Effect.try({
			try: () => {
				record.pty.kill(signal)
			},
			catch: (cause) =>
				new TerminalSignalError({
					terminalId,
					pid: record.pty.pid,
					signal,
					detail: Predicate.isObject(cause) === true ? causeMessage(cause) : "unknown failure"
				})
		})
	})

	const output = Effect.fn("TerminalService.output")(function*(terminalId: TerminalId) {
		const record = yield* requireRecord(terminalId)
		return {
			output: record.buffer.text,
			truncated: record.buffer.truncated,
			exitStatus: record.exitStatus
		} satisfies TerminalOutput
	})

	const waitForExit = Effect.fn("TerminalService.waitForExit")(function*(terminalId: TerminalId) {
		const record = yield* requireRecord(terminalId)
		if (record.exitStatus !== null) {
			return record.exitStatus
		}
		return yield* Deferred.await(record.exit)
	})

	const kill = Effect.fn("TerminalService.kill")(function*(terminalId: TerminalId) {
		return yield* sendSignal(terminalId, "SIGKILL")
	})

	const release = Effect.fn("TerminalService.release")(function*(terminalId: TerminalId) {
		const removed = yield* SynchronizedRef.modify(terminals, (current) => {
			const record = HashMap.get(current, terminalId)
			if (Option.isNone(record)) {
				return [Option.none<TerminalRecord>(), current] as const
			}
			return [record, HashMap.remove(current, terminalId)] as const
		})
		if (Option.isNone(removed)) {
			return yield* new TerminalSessionLookupError({ terminalId })
		}
		yield* teardown(removed.value)
	})

	const releaseSession = Effect.fn("TerminalService.releaseSession")(function*(sessionId: SessionId) {
		const removed = yield* SynchronizedRef.modify(terminals, (current) => {
			const matching = HashMap.filter(current, (record) => record.sessionId === sessionId)
			let next = current
			for (const id of HashMap.keys(matching)) {
				next = HashMap.remove(next, id)
			}
			return [matching.pipe(HashMap.values, Arr.fromIterable), next] as const
		})
		yield* Effect.forEach(removed, teardown, { discard: true })
	})

	yield* Effect.addFinalizer(() =>
		Effect.uninterruptible(
			Effect.gen(function*() {
				const remaining = yield* SynchronizedRef.get(terminals)
				yield* Effect.forEach(remaining.pipe(HashMap.values, Arr.fromIterable), teardown, {
					discard: true
				})
				yield* SynchronizedRef.set(terminals, HashMap.empty())
			})
		)
	)

	return TerminalService.of({
		open,
		write,
		resize,
		signal: sendSignal,
		output,
		waitForExit,
		kill,
		release,
		releaseSession
	})
})

export const TerminalServiceLive = (options: TerminalServiceLiveOptions) =>
	Layer.effect(TerminalService, makeTerminalService(options))
