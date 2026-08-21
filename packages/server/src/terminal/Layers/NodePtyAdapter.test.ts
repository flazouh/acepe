import * as BunChildProcessSpawner from "@effect/platform-bun/BunChildProcessSpawner"
import * as BunFileSystem from "@effect/platform-bun/BunFileSystem"
import * as BunPath from "@effect/platform-bun/BunPath"
import * as Vitest from "@effect/vitest"
import * as Deferred from "effect/Deferred"
import * as Duration from "effect/Duration"
import * as Effect from "effect/Effect"
import * as FileSystem from "effect/FileSystem"
import * as Layer from "effect/Layer"
import { PtyAdapter } from "../Services/PtyAdapter.ts"
import { NodePtyAdapterLive } from "./NodePtyAdapter.ts"

const AdapterLive = NodePtyAdapterLive.pipe(
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

Vitest.it.live(
	"NodePtyAdapterLive spawns /bin/sh -c echo, streams output, and reports exit",
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
	"NodePtyAdapterLive fails spawn for a missing shell",
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
				Vitest.assert.strictEqual(error.adapter, "node-pty")
				Vitest.assert.strictEqual(error.shell, "/no/such/acepe-shell")
			})
		),
	10_000
)
