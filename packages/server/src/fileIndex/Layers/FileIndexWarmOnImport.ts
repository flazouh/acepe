import type { OrchestrationEvent } from "@acepe/contracts"
import * as Cause from "effect/Cause"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Stream from "effect/Stream"
import { OrchestrationEngine } from "../../orchestration/Services/OrchestrationEngine.ts"
import { FileIndexService } from "../Services/FileIndexService.ts"

const makeFileIndexWarmOnImport = Effect.fn("FileIndexWarmOnImport.make")(function*() {
	const engine = yield* OrchestrationEngine
	const fileIndex = yield* FileIndexService
	const layerScope = yield* Effect.scope

	const consider = Effect.fn("FileIndexWarmOnImport.consider")(function*(
		event: OrchestrationEvent
	) {
		if (event.type !== "ProjectCreated") {
			return
		}
		yield* Effect.forkIn(
			fileIndex.prewarm(event.payload.workspaceRoot).pipe(
				Effect.catchCause((cause) =>
					Effect.logWarning("File index prewarm failed").pipe(
						Effect.annotateLogs({
							workspaceRoot: event.payload.workspaceRoot,
							cause: cause.pipe(Cause.pretty)
						})
					)
				)
			),
			layerScope,
			{ startImmediately: true }
		)
	})

	yield* Effect.forkIn(
		engine.streamDomainEvents.pipe(Stream.runForEach((event) => consider(event))),
		layerScope,
		{ startImmediately: true }
	)
})

export const FileIndexWarmOnImportLive = Layer.effectDiscard(makeFileIndexWarmOnImport())
