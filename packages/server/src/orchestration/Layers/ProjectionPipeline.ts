import { type OrchestrationEvent, type Sequence, TrimmedNonEmptyString } from "@acepe/contracts"
import * as Arr from "effect/Array"
import * as Cause from "effect/Cause"
import * as Effect from "effect/Effect"
import * as Fiber from "effect/Fiber"
import * as HashMap from "effect/HashMap"
import * as HashSet from "effect/HashSet"
import * as Layer from "effect/Layer"
import * as Option from "effect/Option"
import * as Queue from "effect/Queue"
import * as Ref from "effect/Ref"
import * as Schema from "effect/Schema"
import * as Stream from "effect/Stream"
import * as SqlClient from "effect/unstable/sql/SqlClient"
import { OrchestrationEventStore } from "../../persistence/Services/OrchestrationEventStore.ts"
import { ProjectionState } from "../../persistence/Services/ProjectionState.ts"
import { OrchestrationEngine } from "../Services/OrchestrationEngine.ts"
import {
	type ProjectorDefinition,
	type ProjectorHealth,
	ProjectionDuplicateNameError,
	ProjectionPipeline,
	ProjectionUnknownError
} from "../Services/ProjectionPipeline.ts"

const EVENT_PAGE_SIZE = 1_000

const decodeProjectorName = Schema.decodeUnknownEffect(TrimmedNonEmptyString)

type ProjectorCursor = {
	lastApplied: Sequence
}

const makeProjectionPipeline = Effect.fn("ProjectionPipeline.make")(function*(
	projectors: ReadonlyArray<ProjectorDefinition>
) {
	const sql = yield* SqlClient.SqlClient
	const eventStore = yield* OrchestrationEventStore
	const projectionState = yield* ProjectionState
	const engine = yield* OrchestrationEngine
	const layerScope = yield* Effect.scope

	let seen = HashSet.empty<TrimmedNonEmptyString>()
	for (const projector of projectors) {
		if (HashSet.has(seen, projector.name)) {
			return yield* new ProjectionDuplicateNameError({ name: projector.name })
		}
		seen = HashSet.add(seen, projector.name)
	}

	const healths = yield* Ref.make(HashMap.empty<TrimmedNonEmptyString, ProjectorHealth>())
	const fibers = yield* Ref.make(
		HashMap.empty<TrimmedNonEmptyString, Fiber.Fiber<void, never>>()
	)

	const findProjector = (name: TrimmedNonEmptyString) =>
		Arr.findFirst(projectors, (projector) => projector.name === name)

	const requireProjector = Effect.fn("ProjectionPipeline.requireProjector")(function*(
		rawName: string
	) {
		const name = yield* decodeProjectorName(rawName)
		const projector = findProjector(name)
		if (Option.isNone(projector)) {
			return yield* new ProjectionUnknownError({ name })
		}
		return projector.value
	})

	const setHealth = (name: TrimmedNonEmptyString, health: ProjectorHealth) =>
		Ref.update(healths, (current) => HashMap.set(current, name, health))

	const applyAndCheckpoint = Effect.fn("ProjectionPipeline.applyAndCheckpoint")(
		function*(definition: ProjectorDefinition, event: OrchestrationEvent) {
			yield* Effect.annotateCurrentSpan({
				"projection.projector": definition.name,
				"projection.sequence": event.sequence
			})
			yield* sql.withTransaction(
				Effect.gen(function*() {
					yield* definition.apply(event, sql)
					yield* projectionState.checkpoint(definition.name, event.sequence)
				})
			)
		}
	)

	const applyIfNewer = Effect.fn("ProjectionPipeline.applyIfNewer")(function*(
		definition: ProjectorDefinition,
		cursor: ProjectorCursor,
		event: OrchestrationEvent
	) {
		if (event.sequence <= cursor.lastApplied) {
			return
		}
		yield* applyAndCheckpoint(definition, event)
		cursor.lastApplied = event.sequence
	})

	const catchUp = Effect.fn("ProjectionPipeline.catchUp")(function*(
		definition: ProjectorDefinition,
		cursor: ProjectorCursor
	) {
		while (true) {
			const page = yield* Stream.runCollect(
				eventStore.readFrom(cursor.lastApplied, EVENT_PAGE_SIZE)
			)
			if (!Arr.isReadonlyArrayNonEmpty(page)) {
				return
			}
			yield* Effect.forEach(page, (event) => applyIfNewer(definition, cursor, event), {
				discard: true
			})
			if (page.length < EVENT_PAGE_SIZE) {
				return
			}
		}
	})

	const processLive = Effect.fn("ProjectionPipeline.processLive")(function*(
		definition: ProjectorDefinition,
		cursor: ProjectorCursor,
		liveQueue: Queue.Queue<OrchestrationEvent, Cause.Done>
	) {
		while (true) {
			const taken = yield* Queue.take(liveQueue).pipe(
				Effect.map(Option.some),
				Effect.catchIf(Cause.isDone, () => Effect.succeed(Option.none()))
			)
			if (Option.isNone(taken)) {
				return
			}
			yield* applyIfNewer(definition, cursor, taken.value)
		}
	})

	const handleFailure = Effect.fn("ProjectionPipeline.handleFailure")(function*<E>(
		definition: ProjectorDefinition,
		cause: Cause.Cause<E>
	) {
		if (Cause.hasInterruptsOnly(cause)) {
			return
		}
		yield* Effect.logError(cause.pipe(Cause.pretty)).pipe(
			Effect.annotateLogs({
				projector: definition.name
			})
		)
		yield* setHealth(definition.name, "degraded")
	})

	const runProjector = Effect.fn("ProjectionPipeline.runProjector")(function*(
		definition: ProjectorDefinition
	) {
		yield* Effect.scoped(
			Effect.gen(function*() {
				yield* Effect.annotateLogsScoped({ projector: definition.name })
				const liveQueue = yield* Queue.unbounded<OrchestrationEvent, Cause.Done>()
				const projectorScope = yield* Effect.scope
				yield* Effect.forkIn(
					engine.streamDomainEvents.pipe(
						Stream.runForEach((event) => Queue.offer(liveQueue, event).pipe(Effect.asVoid)),
						Effect.ensuring(Queue.end(liveQueue))
					),
					projectorScope,
					{ startImmediately: true }
				)
				const cursor: ProjectorCursor = {
					lastApplied: yield* projectionState.lastApplied(definition.name)
				}
				yield* catchUp(definition, cursor)
				yield* catchUp(definition, cursor)
				yield* processLive(definition, cursor, liveQueue)
			})
		)
	})

	const startProjector = Effect.fn("ProjectionPipeline.startProjector")(function*(
		definition: ProjectorDefinition
	) {
		yield* setHealth(definition.name, "healthy")
		const fiber = yield* Effect.forkIn(
			runProjector(definition).pipe(
				Effect.catchCause((cause) => handleFailure(definition, cause))
			),
			layerScope
		)
		yield* Ref.update(fibers, (current) => HashMap.set(current, definition.name, fiber))
	})

	const stopProjector = Effect.fn("ProjectionPipeline.stopProjector")(function*(
		name: TrimmedNonEmptyString
	) {
		const fiber = HashMap.get(yield* Ref.get(fibers), name)
		if (Option.isSome(fiber)) {
			yield* Fiber.interrupt(fiber.value)
			yield* Ref.update(fibers, (current) => HashMap.remove(current, name))
		}
	})

	const resetProjector = Effect.fn("ProjectionPipeline.resetProjector")(function*(
		definition: ProjectorDefinition
	) {
		yield* sql.withTransaction(
			Effect.gen(function*() {
				yield* definition.truncate(sql)
				yield* projectionState.checkpoint(definition.name, 0)
			})
		)
	})

	const rebuild = Effect.fn("ProjectionPipeline.rebuild")(function*(rawName: string) {
		const definition = yield* requireProjector(rawName)
		yield* stopProjector(definition.name)
		yield* resetProjector(definition)
		yield* startProjector(definition)
	})

	const health = Effect.fn("ProjectionPipeline.health")(function*(rawName: string) {
		const definition = yield* requireProjector(rawName)
		const current = HashMap.get(yield* Ref.get(healths), definition.name)
		if (Option.isNone(current)) {
			return yield* new ProjectionUnknownError({ name: definition.name })
		}
		return current.value
	})

	yield* Effect.forEach(projectors, startProjector, { discard: true })

	return ProjectionPipeline.of({
		rebuild,
		health
	})
})

export const ProjectionPipelineLive = (projectors: ReadonlyArray<ProjectorDefinition>) =>
	Layer.effect(ProjectionPipeline, makeProjectionPipeline(projectors))
