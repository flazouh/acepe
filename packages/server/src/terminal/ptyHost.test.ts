import * as BunChildProcessSpawner from "@effect/platform-bun/BunChildProcessSpawner"
import * as BunFileSystem from "@effect/platform-bun/BunFileSystem"
import * as BunPath from "@effect/platform-bun/BunPath"
import * as Vitest from "@effect/vitest"
import * as Deferred from "effect/Deferred"
import * as Duration from "effect/Duration"
import * as Effect from "effect/Effect"
import * as FileSystem from "effect/FileSystem"
import * as Layer from "effect/Layer"
import * as Path from "effect/Path"
import * as Stream from "effect/Stream"
import * as ChildProcess from "effect/unstable/process/ChildProcess"
import { resolveNodeBinary } from "./nodeBinary.ts"
import { decodePtyHostEvent, encodePtyHostCommand } from "./ptyHostProtocol.ts"

const PlatformLive = Layer.mergeAll(
	BunFileSystem.layer,
	BunPath.layer,
	BunChildProcessSpawner.layer.pipe(Layer.provideMerge(Layer.mergeAll(BunFileSystem.layer, BunPath.layer)))
)

const providePlatform = <A, E, R>(program: Effect.Effect<A, E, R>) =>
	program.pipe(
		// @effect-diagnostics-next-line strictEffectProvide:off
		Effect.provide(PlatformLive)
	)

Vitest.it.live(
	"ptyHost.mjs streams echo output and exit over JSON lines",
	() =>
		providePlatform(
			Effect.gen(function*() {
				const path = yield* Path.Path
				const fs = yield* FileSystem.FileSystem
				const cwd = yield* fs.makeTempDirectoryScoped()
				const hostPath = yield* path.fromFileUrl(new URL("./ptyHost.mjs", import.meta.url))
				const nodeBinary = yield* resolveNodeBinary()
				const spawnLine = yield* encodePtyHostCommand({
					op: "spawn",
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
				const child = yield* ChildProcess.make(nodeBinary, [hostPath, spawnLine], {
					extendEnv: true,
					detached: false
				})
				const ready = yield* Deferred.make<number>()
				const chunks: Array<string> = []
				const exited = yield* Deferred.make<{
					readonly exitCode: number | null
					readonly signal: number | null
				}>()
				yield* child.stdout.pipe(
					Stream.decodeText,
					Stream.splitLines,
					Stream.runForEach((line) =>
						decodePtyHostEvent(line).pipe(
							Effect.map((event) => {
								if (event.op === "ready") {
									Deferred.doneUnsafe(ready, Effect.succeed(event.pid))
								} else if (event.op === "data") {
									chunks.push(event.data)
								} else if (event.op === "exit") {
									Deferred.doneUnsafe(
										exited,
										Effect.succeed({
											exitCode: event.exitCode,
											signal: event.signal
										})
									)
								}
							}),
							Effect.ignore
						)
					),
					Effect.forkScoped({ startImmediately: true })
				)
				const pid = yield* Deferred.await(ready).pipe(Effect.timeout(Duration.seconds(5)))
				Vitest.assert.isTrue(pid > 0)
				const status = yield* Deferred.await(exited).pipe(Effect.timeout(Duration.seconds(5)))
				Vitest.assert.strictEqual(status.exitCode, 0)
				Vitest.assert.isTrue(chunks.join("").includes("hello_world"))
			})
		),
	15_000
)
