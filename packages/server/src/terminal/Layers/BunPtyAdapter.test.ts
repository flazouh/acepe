import * as BunChildProcessSpawner from "@effect/platform-bun/BunChildProcessSpawner"
import * as BunFileSystem from "@effect/platform-bun/BunFileSystem"
import * as BunPath from "@effect/platform-bun/BunPath"
import * as Vitest from "@effect/vitest"
import * as Deferred from "effect/Deferred"
import * as Duration from "effect/Duration"
import * as Effect from "effect/Effect"
import * as FileSystem from "effect/FileSystem"
import * as Layer from "effect/Layer"
import * as Stream from "effect/Stream"
import * as ChildProcess from "effect/unstable/process/ChildProcess"
import * as ChildProcessSpawner from "effect/unstable/process/ChildProcessSpawner"
import { PtyAdapter } from "../Services/PtyAdapter.ts"
import { BUN_PTY_ADAPTER, BunPtyAdapterLive } from "./BunPtyAdapter.ts"

const AdapterLive = BunPtyAdapterLive.pipe(
	Layer.provideMerge(
		Layer.mergeAll(
			BunFileSystem.layer,
			BunPath.layer,
			BunChildProcessSpawner.layer.pipe(
				Layer.provideMerge(Layer.mergeAll(BunFileSystem.layer, BunPath.layer))
			)
		)
	)
)

const provideAdapter = <A, E, R>(program: Effect.Effect<A, E, R>) =>
	program.pipe(
		// @effect-diagnostics-next-line strictEffectProvide:off
		Effect.provide(AdapterLive)
	)

const processCommandName = Effect.fn("processCommandName")(function*(pid: number) {
	const spawner = yield* ChildProcessSpawner.ChildProcessSpawner
	const handle = yield* spawner.spawn(
		ChildProcess.make("ps", ["-p", String(pid), "-o", "comm="], {
			extendEnv: true,
			detached: false
		})
	)
	const out = yield* handle.stdout.pipe(Stream.decodeText, Stream.mkString)
	return out.trim()
})

Vitest.it.live(
	"BunPtyAdapterLive spawns /bin/sh -c echo, streams output, and reports exit",
	() =>
		provideAdapter(
			Effect.gen(function*() {
				const fs = yield* FileSystem.FileSystem
				const cwd = yield* fs.makeTempDirectoryScoped()
				const adapter = yield* PtyAdapter
				const exited = yield* Deferred.make<{
					readonly exitCode: number
					readonly signal: number | null
				}>()
				const chunks: Array<string> = []
				const proc = yield* adapter.spawn({
					shell: "/bin/sh",
					args: ["-c", "echo hello_world"],
					cwd,
					cols: 80,
					rows: 24,
					env: {
						PATH: "/bin:/usr/bin:/usr/sbin",
						TERM: "xterm-256color"
					}
				})
				proc.onData((chunk) => {
					chunks.push(chunk)
				})
				proc.onExit((event) => {
					Deferred.doneUnsafe(exited, Effect.succeed(event))
				})
				const status = yield* Deferred.await(exited).pipe(Effect.timeout(Duration.seconds(5)))
				Vitest.assert.strictEqual(status.exitCode, 0)
				Vitest.assert.isTrue(chunks.join("").includes("hello_world"))
				Vitest.assert.isTrue(proc.pid > 0)
			})
		),
	15_000
)

Vitest.it.live(
	"BunPtyAdapterLive fails spawn for a missing shell",
	() =>
		provideAdapter(
			Effect.gen(function*() {
				const adapter = yield* PtyAdapter
				const error = yield* Effect.flip(
					adapter.spawn({
						shell: "/no/such/acepe-shell",
						args: [],
						cwd: "/tmp",
						cols: 80,
						rows: 24,
						env: { PATH: "/bin", TERM: "xterm-256color" }
					})
				)
				Vitest.assert.strictEqual(error._tag, "PtySpawnError")
				Vitest.assert.strictEqual(error.adapter, BUN_PTY_ADAPTER)
				Vitest.assert.strictEqual(error.shell, "/no/such/acepe-shell")
			})
		),
	10_000
)

Vitest.it.live(
	"BunPtyAdapterLive opens a PTY whose OS process is not node",
	() =>
		provideAdapter(
			Effect.gen(function*() {
				const fs = yield* FileSystem.FileSystem
				const cwd = yield* fs.makeTempDirectoryScoped()
				const adapter = yield* PtyAdapter
				const exited = yield* Deferred.make<{
					readonly exitCode: number
					readonly signal: number | null
				}>()
				const proc = yield* adapter.spawn({
					shell: "/bin/sh",
					args: ["-c", "sleep 5"],
					cwd,
					cols: 80,
					rows: 24,
					env: {
						PATH: "/bin:/usr/bin:/usr/sbin",
						TERM: "xterm-256color"
					}
				})
				const comm = yield* processCommandName(proc.pid)
				Vitest.assert.strictEqual(comm.includes("node"), false)
				proc.onExit((event) => {
					Deferred.doneUnsafe(exited, Effect.succeed(event))
				})
				proc.kill("SIGKILL")
				yield* Deferred.await(exited).pipe(Effect.timeout(Duration.seconds(5)))
			})
		),
	15_000
)

Vitest.it.live(
	"BunPtyAdapterLive applies openpty winsize so stty size matches cols and rows",
	() =>
		provideAdapter(
			Effect.gen(function*() {
				const fs = yield* FileSystem.FileSystem
				const cwd = yield* fs.makeTempDirectoryScoped()
				const adapter = yield* PtyAdapter
				const exited = yield* Deferred.make<{
					readonly exitCode: number
					readonly signal: number | null
				}>()
				const chunks: Array<string> = []
				const proc = yield* adapter.spawn({
					shell: "/bin/sh",
					args: ["-c", "stty size"],
					cwd,
					cols: 60,
					rows: 20,
					env: {
						PATH: "/usr/bin:/bin",
						TERM: "xterm-256color"
					}
				})
				proc.onData((chunk) => {
					chunks.push(chunk)
				})
				proc.onExit((event) => {
					Deferred.doneUnsafe(exited, Effect.succeed(event))
				})
				const status = yield* Deferred.await(exited).pipe(Effect.timeout(Duration.seconds(5)))
				Vitest.assert.strictEqual(status.exitCode, 0)
				Vitest.assert.isTrue(chunks.join("").includes("20 60"))
			})
		),
	15_000
)

Vitest.it.live(
	"BunPtyAdapterLive resize uses TIOCSWINSZ so a later stty size matches",
	() =>
		provideAdapter(
			Effect.gen(function*() {
				const fs = yield* FileSystem.FileSystem
				const cwd = yield* fs.makeTempDirectoryScoped()
				const adapter = yield* PtyAdapter
				const exited = yield* Deferred.make<{
					readonly exitCode: number
					readonly signal: number | null
				}>()
				const chunks: Array<string> = []
				const proc = yield* adapter.spawn({
					shell: "/bin/sh",
					args: ["-c", "sleep 0.2; stty size"],
					cwd,
					cols: 80,
					rows: 24,
					env: {
						PATH: "/usr/bin:/bin",
						TERM: "xterm-256color"
					}
				})
				proc.onData((chunk) => {
					chunks.push(chunk)
				})
				proc.onExit((event) => {
					Deferred.doneUnsafe(exited, Effect.succeed(event))
				})
				proc.resize(40, 12)
				const status = yield* Deferred.await(exited).pipe(Effect.timeout(Duration.seconds(5)))
				Vitest.assert.strictEqual(status.exitCode, 0)
				Vitest.assert.isTrue(chunks.join("").includes("12 40"))
			})
		),
	15_000
)
