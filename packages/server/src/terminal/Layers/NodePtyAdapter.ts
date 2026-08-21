import * as Deferred from "effect/Deferred"
import * as Duration from "effect/Duration"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Path from "effect/Path"
import * as Queue from "effect/Queue"
import * as Scope from "effect/Scope"
import * as Stream from "effect/Stream"
import * as ChildProcess from "effect/unstable/process/ChildProcess"
import * as ChildProcessSpawner from "effect/unstable/process/ChildProcessSpawner"
import {
	PtyAdapter,
	type PtyExitEvent,
	type PtyProcess,
	type PtySignal,
	PtySpawnError,
	type PtySpawnInput
} from "../Services/PtyAdapter.ts"
import { resolveNodeBinary } from "../nodeBinary.ts"
import {
	decodePtyHostEvent,
	encodePtyHostCommand,
	type PtyHostCommand,
	type PtyHostEvent
} from "../ptyHostProtocol.ts"

const HOST_READY_TIMEOUT = Duration.seconds(5)

const toExitEvent = (event: Extract<PtyHostEvent, { readonly op: "exit" }>): PtyExitEvent => ({
	exitCode: event.exitCode === null ? 0 : event.exitCode,
	signal: event.signal
})

export const makeNodePtyAdapter = Effect.fn("NodePtyAdapter.make")(function*() {
	const path = yield* Path.Path
	const spawner = yield* ChildProcessSpawner.ChildProcessSpawner
	const layerScope = yield* Effect.scope
	const hostPath = yield* path.fromFileUrl(new URL("../ptyHost.mjs", import.meta.url))
	const nodeBinary = yield* resolveNodeBinary()

	const spawnPty = Effect.fn("NodePtyAdapter.spawn")(function*(input: PtySpawnInput) {
		const commandLines = yield* Queue.unbounded<PtyHostCommand>()
		const ready = yield* Deferred.make<number, PtySpawnError>()
		const spawnLine = yield* encodePtyHostCommand({
			op: "spawn",
			shell: input.shell,
			args: input.args,
			cwd: input.cwd,
			cols: input.cols,
			rows: input.rows,
			env: input.env
		}).pipe(
			Effect.mapError(
				(error) =>
					new PtySpawnError({
						adapter: "node-pty",
						shell: input.shell,
						detail: error.message
					})
			)
		)
		const child = yield* spawner
			.spawn(
				ChildProcess.make(nodeBinary, [hostPath, spawnLine], {
					extendEnv: true,
					detached: false
				})
			)
			.pipe(
				Effect.provideService(Scope.Scope, layerScope),
				Effect.mapError(
					(error) =>
						new PtySpawnError({
							adapter: "node-pty",
							shell: input.shell,
							detail: error.message
						})
				)
			)
		let dataCb: ((data: string) => void) | undefined
		let exitCb: ((event: PtyExitEvent) => void) | undefined
		const pendingData: Array<string> = []
		let pendingExit: PtyExitEvent | undefined
		const handleEvent = (event: PtyHostEvent): void => {
			if (event.op === "ready") {
				Deferred.doneUnsafe(ready, Effect.succeed(event.pid))
				return
			}
			if (event.op === "error") {
				Deferred.doneUnsafe(
					ready,
					Effect.fail(
						new PtySpawnError({
							adapter: "node-pty",
							shell: input.shell,
							detail: event.detail
						})
					)
				)
				return
			}
			if (event.op === "data") {
				if (dataCb !== undefined) {
					dataCb(event.data)
					return
				}
				pendingData.push(event.data)
				return
			}
			if (exitCb !== undefined) {
				exitCb(toExitEvent(event))
				return
			}
			pendingExit = toExitEvent(event)
		}
		yield* child.stdout.pipe(
			Stream.decodeText,
			Stream.splitLines,
			Stream.runForEach((line) =>
				decodePtyHostEvent(line).pipe(
					Effect.map((event) => {
						handleEvent(event)
					}),
					Effect.ignore
				)
			),
			Effect.forkIn(layerScope, { startImmediately: true })
		)
		yield* Stream.fromQueue(commandLines).pipe(
			Stream.mapEffect((command) => encodePtyHostCommand(command)),
			Stream.map((line) => `${line}\n`),
			Stream.encodeText,
			Stream.run(child.stdin),
			Effect.forkIn(layerScope, { startImmediately: true })
		)
		const pid = yield* Deferred.await(ready).pipe(
			Effect.timeoutOrElse({
				duration: HOST_READY_TIMEOUT,
				orElse: () =>
					new PtySpawnError({
						adapter: "node-pty",
						shell: input.shell,
						detail: "timed out waiting for node-pty host"
					})
			})
		)
		const send = (command: PtyHostCommand): void => {
			Queue.offerUnsafe(commandLines, command)
		}
		const wrapped: PtyProcess = {
			pid,
			write: (data: string) => {
				send({ op: "write", data })
			},
			resize: (cols: number, rows: number) => {
				send({ op: "resize", cols, rows })
			},
			kill: (signal?: PtySignal) => {
				if (signal === undefined) {
					send({ op: "kill" })
					return
				}
				send({ op: "kill", signal })
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
		return wrapped
	})

	return PtyAdapter.of({
		spawn: spawnPty
	})
})

export const NodePtyAdapterLive = Layer.effect(PtyAdapter, makeNodePtyAdapter())
