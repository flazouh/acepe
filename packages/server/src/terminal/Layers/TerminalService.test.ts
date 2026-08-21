import * as BunChildProcessSpawner from "@effect/platform-bun/BunChildProcessSpawner"
import * as BunCrypto from "@effect/platform-bun/BunCrypto"
import * as BunFileSystem from "@effect/platform-bun/BunFileSystem"
import * as BunPath from "@effect/platform-bun/BunPath"
import * as Vitest from "@effect/vitest"
import { SessionId } from "@acepe/contracts"
import * as ConfigProvider from "effect/ConfigProvider"
import * as Duration from "effect/Duration"
import * as Effect from "effect/Effect"
import * as FileSystem from "effect/FileSystem"
import * as Layer from "effect/Layer"
import * as Option from "effect/Option"
import * as Path from "effect/Path"
import * as Rec from "effect/Record"
import * as Schema from "effect/Schema"
import * as ChildProcess from "effect/unstable/process/ChildProcess"
import * as ChildProcessSpawner from "effect/unstable/process/ChildProcessSpawner"
import {
	PtyAdapter,
	type PtyAdapterShape,
	type PtyExitEvent,
	type PtyProcess,
	type PtySignal,
	type PtySpawnInput
} from "../Services/PtyAdapter.ts"
import {
	OpenTerminalInput,
	TerminalCwdNotFoundError,
	TerminalNotRunningError,
	TerminalService,
	TerminalSessionLookupError
} from "../Services/TerminalService.ts"
import { DEFAULT_TERM } from "../shellEnv.ts"
import { BunPtyAdapterLive } from "./BunPtyAdapter.ts"
import { TerminalServiceLive } from "./TerminalService.ts"

const sessionId = SessionId.make("session-1")
const otherSession = SessionId.make("session-2")

type FakePty = PtyProcess & {
	readonly writes: Array<string>
	size: { cols: number; rows: number }
	lastSignal: PtySignal | undefined
	emitData: (data: string) => void
	emitExit: (event: PtyExitEvent) => void
}

const makeFakeAdapter = () => {
	let nextPid = 1
	const byPid = new Map<number, FakePty>()
	const alive = new Set<number>()
	const spawns: Array<PtySpawnInput> = []

	const adapter = PtyAdapter.of({
		spawn: (input) =>
			Effect.sync(() => {
				const pid = nextPid
				nextPid = nextPid + 1
				spawns.push(input)
				alive.add(pid)
				let dataCb: ((data: string) => void) | undefined
				let exitCb: ((event: PtyExitEvent) => void) | undefined
				const proc: FakePty = {
					pid,
					writes: [],
					size: { cols: input.cols, rows: input.rows },
					lastSignal: undefined,
					write: (data) => {
						proc.writes.push(data)
					},
					resize: (cols, rows) => {
						proc.size = { cols, rows }
					},
					kill: (signal) => {
						proc.lastSignal = signal
						alive.delete(pid)
						if (exitCb !== undefined) {
							exitCb({
								exitCode: 0,
								signal: 15
							})
						}
					},
					onData: (callback) => {
						dataCb = callback
						return () => {
							dataCb = undefined
						}
					},
					onExit: (callback) => {
						exitCb = callback
						return () => {
							exitCb = undefined
						}
					},
					emitData: (data) => {
						if (dataCb !== undefined) {
							dataCb(data)
						}
					},
					emitExit: (event) => {
						alive.delete(pid)
						if (exitCb !== undefined) {
							exitCb(event)
						}
					}
				}
				byPid.set(pid, proc)
				return proc
			})
	})

	return { adapter, byPid, alive, spawns }
}

const fake = makeFakeAdapter()

const PlatformLive = Layer.mergeAll(
	BunCrypto.layer,
	BunFileSystem.layer,
	BunPath.layer,
	BunChildProcessSpawner.layer.pipe(Layer.provideMerge(Layer.mergeAll(BunFileSystem.layer, BunPath.layer)))
)

const TestLive = TerminalServiceLive({
	processKillGrace: Duration.millis(20),
	loginEnv: Option.some(
		Rec.fromEntries([
			["PATH", "/opt/homebrew/bin:/usr/bin"],
			["HOME", "/tmp"]
		])
	),
	defaultShellOverride: Option.some("/bin/sh"),
	loginEnvCaptureTimeout: Duration.seconds(5)
}).pipe(
	Layer.provide(Layer.succeed(PtyAdapter, fake.adapter)),
	Layer.provideMerge(PlatformLive),
	Layer.provide(
		ConfigProvider.layer(
			ConfigProvider.fromEnv({
				env: {
					SHELL: "/bin/sh",
					PATH: "/usr/bin",
					HOME: "/tmp"
				}
			})
		)
	)
)

const requireFake = (pid: number): FakePty => {
	const proc = fake.byPid.get(pid)
	if (proc === undefined) {
		return Vitest.assert.fail(`missing fake pty ${pid}`)
	}
	return proc
}

Vitest.layer(TestLive)("TerminalServiceLive", (it) => {
	it.effect("opens an interactive shell with login PATH, TERM, resize, signals, and session teardown", () =>
		Effect.gen(function*() {
			const fs = yield* FileSystem.FileSystem
			const cwd = yield* fs.makeTempDirectoryScoped()
			const terminals = yield* TerminalService
			const handle = yield* terminals.open(
				OpenTerminalInput.make({
					sessionId,
					cwd
				})
			)
			const proc = requireFake(handle.pid)
			const spawn = fake.spawns[fake.spawns.length - 1]
			Vitest.assert.isDefined(spawn)
			Vitest.assert.strictEqual(spawn?.shell, "/bin/sh")
			Vitest.assert.deepStrictEqual(spawn?.args, [])
			Vitest.assert.strictEqual(spawn?.env["PATH"], "/opt/homebrew/bin:/usr/bin")
			Vitest.assert.strictEqual(spawn?.env["TERM"], DEFAULT_TERM)
			proc.emitData("prompt> ")
			yield* terminals.write(handle.terminalId, "echo hi\n")
			Vitest.assert.deepStrictEqual(proc.writes, ["echo hi\n"])
			yield* terminals.resize(handle.terminalId, 40, 12)
			Vitest.assert.deepStrictEqual(proc.size, { cols: 40, rows: 12 })
			const before = yield* terminals.output(handle.terminalId)
			Vitest.assert.strictEqual(before.output, "prompt> ")
			Vitest.assert.strictEqual(before.exitStatus, null)
			yield* terminals.signal(handle.terminalId, "SIGINT")
			Vitest.assert.strictEqual(proc.lastSignal, "SIGINT")
			const second = yield* terminals.open(
				OpenTerminalInput.make({
					sessionId,
					cwd
				})
			)
			yield* terminals.releaseSession(sessionId)
			const missing = yield* Effect.flip(terminals.output(handle.terminalId))
			Vitest.assert.strictEqual(missing._tag, "TerminalSessionLookupError")
			Vitest.assert.isTrue(Schema.is(TerminalSessionLookupError)(missing))
			const missingSecond = yield* Effect.flip(terminals.output(second.terminalId))
			Vitest.assert.strictEqual(missingSecond._tag, "TerminalSessionLookupError")
			Vitest.assert.strictEqual(fake.alive.has(handle.pid), false)
			Vitest.assert.strictEqual(fake.alive.has(second.pid), false)
		})
	)

	it.effect("runs a command terminal, buffers output, waits for exit, and enforces the byte limit", () =>
		Effect.gen(function*() {
			const fs = yield* FileSystem.FileSystem
			const cwd = yield* fs.makeTempDirectoryScoped()
			const terminals = yield* TerminalService
			const handle = yield* terminals.open(
				OpenTerminalInput.make({
					sessionId: otherSession,
					cwd,
					command: "echo hello_world",
					outputByteLimit: 4
				})
			)
			const proc = requireFake(handle.pid)
			const spawn = fake.spawns[fake.spawns.length - 1]
			Vitest.assert.deepStrictEqual(spawn?.args, ["-c", "echo hello_world"])
			proc.emitData("abcdefghij")
			proc.emitExit({ exitCode: 0, signal: null })
			const exit = yield* terminals.waitForExit(handle.terminalId)
			Vitest.assert.deepStrictEqual(exit, { exitCode: 0, signal: null })
			const out = yield* terminals.output(handle.terminalId)
			Vitest.assert.strictEqual(out.truncated, true)
			Vitest.assert.strictEqual(out.output, "ghij")
			Vitest.assert.deepStrictEqual(out.exitStatus, { exitCode: 0, signal: null })
			yield* terminals.release(handle.terminalId)
		})
	)

	it.effect("rejects a missing cwd and write after exit", () =>
		Effect.gen(function*() {
			const terminals = yield* TerminalService
			const missingCwd = yield* Effect.flip(
				terminals.open(
					OpenTerminalInput.make({
						sessionId,
						cwd: "/no/such/acepe-terminal-cwd"
					})
				)
			)
			Vitest.assert.strictEqual(missingCwd._tag, "TerminalCwdNotFoundError")
			Vitest.assert.isTrue(Schema.is(TerminalCwdNotFoundError)(missingCwd))
			const fs = yield* FileSystem.FileSystem
			const cwd = yield* fs.makeTempDirectoryScoped()
			const handle = yield* terminals.open(
				OpenTerminalInput.make({
					sessionId,
					cwd
				})
			)
			requireFake(handle.pid).emitExit({ exitCode: 1, signal: null })
			const stopped = yield* Effect.flip(terminals.write(handle.terminalId, "x"))
			Vitest.assert.strictEqual(stopped._tag, "TerminalNotRunningError")
			Vitest.assert.isTrue(Schema.is(TerminalNotRunningError)(stopped))
			yield* terminals.release(handle.terminalId)
		})
	)

	it.effect("leaves no live fake processes after 100 open-and-close cycles", () =>
		Effect.gen(function*() {
			const fs = yield* FileSystem.FileSystem
			const cwd = yield* fs.makeTempDirectoryScoped()
			const terminals = yield* TerminalService
			const pids: Array<number> = []
			let i = 0
			while (i < 100) {
				const handle = yield* terminals.open(
					OpenTerminalInput.make({
						sessionId,
						cwd
					})
				)
				pids.push(handle.pid)
				yield* terminals.release(handle.terminalId)
				i = i + 1
			}
			for (const pid of pids) {
				Vitest.assert.strictEqual(fake.alive.has(pid), false)
			}
		})
	)
})

const runCaptured = <A, E>(
	adapter: PtyAdapterShape,
	shell: string,
	timeout: Duration.Duration,
	program: Effect.Effect<A, E, TerminalService | FileSystem.FileSystem>
) =>
	program.pipe(
		// @effect-diagnostics-next-line strictEffectProvide:off
		Effect.provide(
			TerminalServiceLive({
				processKillGrace: Duration.millis(20),
				loginEnv: Option.none(),
				defaultShellOverride: Option.some("/bin/sh"),
				loginEnvCaptureTimeout: timeout
			}).pipe(
				Layer.provide(Layer.succeed(PtyAdapter, adapter)),
				Layer.provideMerge(PlatformLive),
				Layer.provide(
					ConfigProvider.layer(
						ConfigProvider.fromEnv({
							env: {
								SHELL: shell,
								PATH: "/fallback-path",
								HOME: "/tmp"
							}
						})
					)
				)
			)
		)
	)

const providePlatform = <A, E, R>(program: Effect.Effect<A, E, R>) =>
	program.pipe(
		// @effect-diagnostics-next-line strictEffectProvide:off
		Effect.provide(PlatformLive)
	)

Vitest.it.live(
	"uses PATH from login-shell capture, including the marker payload",
	() =>
		providePlatform(
			Effect.gen(function*() {
				const fs = yield* FileSystem.FileSystem
				const path = yield* Path.Path
				const dir = yield* fs.makeTempDirectoryScoped()
				const captureShell = path.join(dir, "capture-shell")
				yield* fs.writeFileString(
					captureShell,
					"#!/bin/sh\nprintf '__ACEPE_ENV_START__\\0'\nprintf 'PATH=/opt/acepe-login/bin:/usr/bin\\0'\nprintf 'HOME=/tmp\\0'\n"
				)
				yield* fs.chmod(captureShell, 0o755)
				const captureFake = makeFakeAdapter()
				const cwd = yield* fs.makeTempDirectoryScoped()
				yield* runCaptured(
					captureFake.adapter,
					captureShell,
					Duration.seconds(5),
					Effect.gen(function*() {
						const terminals = yield* TerminalService
						const handle = yield* terminals.open(
							OpenTerminalInput.make({
								sessionId,
								cwd
							})
						)
						const spawn = captureFake.spawns[0]
						Vitest.assert.isDefined(spawn)
						Vitest.assert.strictEqual(spawn?.env["PATH"], "/opt/acepe-login/bin:/usr/bin")
						Vitest.assert.strictEqual(spawn?.env["HOME"], "/tmp")
						yield* terminals.release(handle.terminalId)
					})
				)
			})
		),
	15_000
)

const LiveTerminal = TerminalServiceLive({
	processKillGrace: Duration.millis(250),
	loginEnv: Option.some(
		Rec.fromEntries([
			["PATH", "/bin:/usr/bin:/usr/sbin"],
			["HOME", "/tmp"]
		])
	),
	defaultShellOverride: Option.some("/bin/sh"),
	loginEnvCaptureTimeout: Duration.seconds(5)
}).pipe(
	Layer.provide(BunPtyAdapterLive),
	Layer.provideMerge(PlatformLive),
	Layer.provide(
		ConfigProvider.layer(
			ConfigProvider.fromEnv({
				env: {
					SHELL: "/bin/sh",
					PATH: "/bin:/usr/bin:/usr/sbin",
					HOME: "/tmp"
				}
			})
		)
	)
)

const pidIsGone = Effect.fn("pidIsGone")(function*(pid: number) {
	const spawner = yield* ChildProcessSpawner.ChildProcessSpawner
	const code = yield* spawner.exitCode(
		ChildProcess.make("kill", ["-0", String(pid)], { extendEnv: true, detached: false })
	)
	return code !== 0
})

const provideLive = <A, E, R>(program: Effect.Effect<A, E, R>) =>
	program.pipe(
		// @effect-diagnostics-next-line strictEffectProvide:off
		Effect.provide(LiveTerminal)
	)

Vitest.it.live(
	"falls back to PATH after a login-shell capture timeout",
	() =>
		Effect.gen(function*() {
			const fs = yield* FileSystem.FileSystem
			const path = yield* Path.Path
			const dir = yield* fs.makeTempDirectoryScoped()
			const slowShell = path.join(dir, "slow-shell")
			yield* fs.writeFileString(slowShell, "#!/bin/sh\nsleep 2\n")
			yield* fs.chmod(slowShell, 0o755)
			const captureFake = makeFakeAdapter()
			const cwd = yield* fs.makeTempDirectoryScoped()
			yield* runCaptured(
				captureFake.adapter,
				slowShell,
				Duration.millis(50),
				Effect.gen(function*() {
					const terminals = yield* TerminalService
					const handle = yield* terminals.open(
						OpenTerminalInput.make({
							sessionId,
							cwd
						})
					)
					const spawn = captureFake.spawns[0]
					Vitest.assert.isDefined(spawn)
					Vitest.assert.strictEqual(spawn?.env["PATH"], "/fallback-path")
					yield* terminals.release(handle.terminalId)
				})
			)
		}).pipe(
			// @effect-diagnostics-next-line strictEffectProvide:off
			Effect.provide(PlatformLive)
		),
	10_000
)

Vitest.it.live(
	"runs an interactive shell with write, resize, SIGINT, SIGKILL, and session teardown",
	() =>
		provideLive(
			Effect.gen(function*() {
				const fs = yield* FileSystem.FileSystem
				const cwd = yield* fs.makeTempDirectoryScoped()
				const terminals = yield* TerminalService
				const handle = yield* terminals.open(
					OpenTerminalInput.make({
						sessionId,
						cwd
					})
				)
				yield* terminals.resize(handle.terminalId, 60, 20)
				yield* terminals.write(handle.terminalId, "echo ACEPE_PTY_OK\n")
				let attempts = 0
				let found = false
				while (attempts < 40 && found === false) {
					const out = yield* terminals.output(handle.terminalId)
					if (out.output.includes("ACEPE_PTY_OK") === true) {
						found = true
					} else {
						yield* Effect.sleep(Duration.millis(50))
						attempts = attempts + 1
					}
				}
				Vitest.assert.strictEqual(found, true)
				yield* terminals.signal(handle.terminalId, "SIGINT")
				yield* terminals.signal(handle.terminalId, "SIGKILL")
				const exit = yield* terminals.waitForExit(handle.terminalId).pipe(
					Effect.timeout(Duration.seconds(3))
				)
				Vitest.assert.isTrue(exit.exitCode !== null || exit.signal !== null)
				yield* terminals.releaseSession(sessionId)
				const gone = yield* pidIsGone(handle.pid)
				Vitest.assert.strictEqual(gone, true)
			})
		),
	20_000
)

Vitest.it.live(
	"leaves no OS processes after 100 open-and-close cycles",
	() =>
		provideLive(
			Effect.gen(function*() {
				const fs = yield* FileSystem.FileSystem
				const cwd = yield* fs.makeTempDirectoryScoped()
				const terminals = yield* TerminalService
				const pids: Array<number> = []
				let i = 0
				while (i < 100) {
					const handle = yield* terminals.open(
						OpenTerminalInput.make({
							sessionId,
							cwd
						})
					)
					pids.push(handle.pid)
					yield* terminals.release(handle.terminalId)
					i = i + 1
				}
				for (const pid of pids) {
					const gone = yield* pidIsGone(pid)
					Vitest.assert.strictEqual(gone, true)
				}
			})
		),
	60_000
)

Vitest.it.live(
	"keeps command output after waitForExit",
	() =>
		provideLive(
			Effect.gen(function*() {
				const fs = yield* FileSystem.FileSystem
				const cwd = yield* fs.makeTempDirectoryScoped()
				const terminals = yield* TerminalService
				const handle = yield* terminals.open(
					OpenTerminalInput.make({
						sessionId,
						cwd,
						command: "echo hello_world"
					})
				)
				const exit = yield* terminals.waitForExit(handle.terminalId).pipe(
					Effect.timeout(Duration.seconds(5))
				)
				Vitest.assert.strictEqual(exit.exitCode, 0)
				const out = yield* terminals.output(handle.terminalId)
				Vitest.assert.isTrue(out.output.includes("hello_world"))
				yield* terminals.release(handle.terminalId)
				const gone = yield* pidIsGone(handle.pid)
				Vitest.assert.strictEqual(gone, true)
			})
		),
	15_000
)
