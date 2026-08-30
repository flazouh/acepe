import {
	makeResumingRpcClient,
	RpcSchemaError,
	RpcTransportError,
	type RpcTransport
} from "@acepe/contracts"
import * as BunChildProcessSpawner from "@effect/platform-bun/BunChildProcessSpawner"
import * as BunFileSystem from "@effect/platform-bun/BunFileSystem"
import * as BunPath from "@effect/platform-bun/BunPath"
import * as Vitest from "@effect/vitest"
import * as Arr from "effect/Array"
import * as Cause from "effect/Cause"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Path from "effect/Path"
import * as Queue from "effect/Queue"
import * as Ref from "effect/Ref"
import * as Stream from "effect/Stream"
import * as Str from "effect/String"
import * as ChildProcess from "effect/unstable/process/ChildProcess"
import type { ChildProcessHandle } from "effect/unstable/process/ChildProcessSpawner"
import { decodeEventLine, parseFromFlag } from "./eventStreamProcess.ts"

const ProcessLive = BunChildProcessSpawner.layer.pipe(
	Layer.provideMerge(Layer.mergeAll(BunFileSystem.layer, BunPath.layer))
)

const ioToTransportError = (error: { readonly message: string }) =>
	new RpcTransportError({ reason: error.message })

const stdoutEvents = (child: ChildProcessHandle) =>
	child.stdout.pipe(
		Stream.decodeText,
		Stream.splitLines,
		Stream.filter((line) => Str.isNonEmpty(Str.trim(line))),
		Stream.mapError(ioToTransportError),
		Stream.mapEffect((line) =>
			decodeEventLine(line).pipe(
				Effect.mapError((error) => new RpcSchemaError({ issue: error.message }))
			)
		)
	)

Vitest.it.effect("parseFromFlag reads --from or defaults to 0", () =>
	Effect.gen(function*() {
		const fromMissing = yield* parseFromFlag([])
		const fromFlag = yield* parseFromFlag(["--from", "4"])
		Vitest.assert.strictEqual(fromMissing, 0)
		Vitest.assert.strictEqual(fromFlag, 4)
	})
)

Vitest.it.live(
	"kills the bun process mid-stream and resumes without a gap or duplicate",
	() =>
		Effect.gen(function*() {
			const path = yield* Path.Path
			const scriptPath = yield* path.fromFileUrl(
				new URL("./eventStreamProcess.ts", import.meta.url)
			)
			const spawned = yield* Queue.unbounded<ChildProcessHandle, Cause.Done>()
			const killed = yield* Ref.make(false)
			const unusedDispatch: RpcTransport["dispatch"] = () =>
				Effect.fail(new RpcTransportError({ reason: "unused dispatch" }))
			const unusedSnapshot: RpcTransport["snapshot"] = () =>
				Effect.fail(new RpcTransportError({ reason: "unused snapshot" }))
			const unusedGetProjectIndex: RpcTransport["getProjectIndex"] = () =>
				Effect.fail(new RpcTransportError({ reason: "unused getProjectIndex" }))
			const unusedInvalidateProjectIndex: RpcTransport["invalidateProjectIndex"] = () =>
				Effect.fail(new RpcTransportError({ reason: "unused invalidateProjectIndex" }))
			const unusedReadTextFile: RpcTransport["readTextFile"] = () =>
				Effect.fail(new RpcTransportError({ reason: "unused readTextFile" }))
			const unusedReadImageDataUrl: RpcTransport["readImageDataUrl"] = () =>
				Effect.fail(new RpcTransportError({ reason: "unused readImageDataUrl" }))
			const unusedWriteTextFile: RpcTransport["writeTextFile"] = () =>
				Effect.fail(new RpcTransportError({ reason: "unused writeTextFile" }))
			const unusedGetDefaultShell: RpcTransport["getDefaultShell"] = () =>
				Effect.fail(new RpcTransportError({ reason: "unused getDefaultShell" }))
			const unusedGitCall: RpcTransport["gitCall"] = () =>
				Effect.fail(new RpcTransportError({ reason: "unused gitCall" }))
			const unusedAgentCall: RpcTransport["agentCall"] = () =>
				Effect.fail(new RpcTransportError({ reason: "unused agentCall" }))
			const unusedGetProviderAccountUsage: RpcTransport["getProviderAccountUsage"] = () =>
				Effect.fail(new RpcTransportError({ reason: "unused getProviderAccountUsage" }))
			const unusedListProviderSessions: RpcTransport["listProviderSessions"] = () =>
				Effect.fail(new RpcTransportError({ reason: "unused listProviderSessions" }))
			const unusedListProviderProjects: RpcTransport["listProviderProjects"] = () =>
				Effect.fail(new RpcTransportError({ reason: "unused listProviderProjects" }))
			const unusedImportProviderSession: RpcTransport["importProviderSession"] = () =>
				Effect.fail(new RpcTransportError({ reason: "unused importProviderSession" }))
			const transport = {
				dispatch: unusedDispatch,
				snapshot: unusedSnapshot,
				getProjectIndex: unusedGetProjectIndex,
				invalidateProjectIndex: unusedInvalidateProjectIndex,
				readTextFile: unusedReadTextFile,
				readImageDataUrl: unusedReadImageDataUrl,
				writeTextFile: unusedWriteTextFile,
				getDefaultShell: unusedGetDefaultShell,
				gitCall: unusedGitCall,
				agentCall: unusedAgentCall,
				getProviderAccountUsage: unusedGetProviderAccountUsage,
				listProviderSessions: unusedListProviderSessions,
				listProviderProjects: unusedListProviderProjects,
				importProviderSession: unusedImportProviderSession,
				events: (fromSequence: Parameters<RpcTransport["events"]>[0]) =>
					Stream.unwrap(
						Effect.gen(function*() {
							const child = yield* ChildProcess.make(
								"bun",
								[scriptPath, "--from", String(fromSequence)],
								{ extendEnv: true }
							)
							yield* Queue.offer(spawned, child)
							return stdoutEvents(child)
						}).pipe(Effect.mapError(ioToTransportError))
					)
			}
			const client = makeResumingRpcClient(transport)
			const events = yield* Stream.runCollect(
				client.events(0).pipe(
					Stream.tap((event) =>
						Effect.gen(function*() {
							const already = yield* Ref.get(killed)
							if (already === true) {
								return
							}
							if (event.sequence < 3) {
								return
							}
							yield* Ref.set(killed, true)
							const child = yield* Queue.take(spawned)
							yield* child.kill({ killSignal: "SIGKILL" })
						})
					),
					Stream.take(8)
				)
			)
			const sequences = Arr.map(events, (event) => event.sequence)
			Vitest.assert.deepStrictEqual(sequences, [1, 2, 3, 4, 5, 6, 7, 8])
		}).pipe(
			// @effect-diagnostics-next-line strictEffectProvide:off
			Effect.provide(ProcessLive)
		),
	20_000
)
