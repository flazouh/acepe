import {
	CommandId,
	EventId,
	ProjectCreateCommand,
	ProjectId,
	SessionCreateCommand,
	SessionId
} from "@acepe/contracts"
import * as BunCrypto from "@effect/platform-bun/BunCrypto"
import * as BunFileSystem from "@effect/platform-bun/BunFileSystem"
import * as BunPath from "@effect/platform-bun/BunPath"
import * as Vitest from "@effect/vitest"
import * as Arr from "effect/Array"
import * as Duration from "effect/Duration"
import * as Effect from "effect/Effect"
import * as Exit from "effect/Exit"
import * as Fiber from "effect/Fiber"
import * as FileSystem from "effect/FileSystem"
import * as Layer from "effect/Layer"
import * as Metric from "effect/Metric"
import * as Option from "effect/Option"
import * as Order from "effect/Order"
import * as Path from "effect/Path"
import * as Schema from "effect/Schema"
import * as Stream from "effect/Stream"
import * as TestClock from "effect/testing/TestClock"
import { runMigrations } from "../../persistence/Migrations.ts"
import { OrchestrationCommandReceipts } from "../../persistence/Services/OrchestrationCommandReceipts.ts"
import {
	type NewOrchestrationEvent,
	OrchestrationEventStore
} from "../../persistence/Services/OrchestrationEventStore.ts"
import { OrchestrationCommandReceiptsLive } from "../../persistence/Layers/OrchestrationCommandReceipts.ts"
import { OrchestrationEventStoreLive } from "../../persistence/Layers/OrchestrationEventStore.ts"
import { makeSqliteLayer } from "../../persistence/Layers/Sqlite.ts"
import { OrchestrationCommandInvariantError } from "../Errors.ts"
import {
	orchestrationCommandAckDuration,
	orchestrationCommandDuration,
	orchestrationCommandsTotal,
	OrchestrationEngine
} from "../Services/OrchestrationEngine.ts"
import { OrchestrationEngineLive } from "./OrchestrationEngine.ts"

const occurredAt = "2026-08-20T12:00:00.000Z"
const projectId = ProjectId.make("project-1")
const sessionId = SessionId.make("session-1")

const projectCreated = (eventId: string): NewOrchestrationEvent => ({
	eventId: EventId.make(eventId),
	aggregateKind: "project",
	aggregateId: projectId,
	occurredAt,
	commandId: CommandId.make("cmd-preload"),
	causationEventId: null,
	correlationId: CommandId.make("cmd-preload"),
	metadata: {},
	type: "ProjectCreated",
	payload: {
		projectId,
		title: "Acepe",
		workspaceRoot: "/tmp/acepe"
	}
})

const createProjectCommand = (commandId: string, id: string) =>
	ProjectCreateCommand.make({
		type: "project.create",
		commandId: CommandId.make(commandId),
		projectId: ProjectId.make(id),
		title: "Acepe",
		workspaceRoot: "/tmp/acepe"
	})

const createSessionCommand = (commandId: string) =>
	SessionCreateCommand.make({
		type: "session.create",
		commandId: CommandId.make(commandId),
		sessionId,
		projectId,
		title: "First session"
	})

const TempSqlite = Layer.unwrap(
	Effect.gen(function*() {
		const fs = yield* FileSystem.FileSystem
		const path = yield* Path.Path
		const dir = yield* fs.makeTempDirectoryScoped()
		return makeSqliteLayer({
			filename: path.join(dir, "acepe-test.db"),
			readonly: false
		})
	})
).pipe(Layer.provide(Layer.mergeAll(BunFileSystem.layer, BunPath.layer)))

const MigratedSqlite = Layer.effectDiscard(runMigrations).pipe(Layer.provideMerge(TempSqlite))

const PersistenceLive = Layer.mergeAll(
	OrchestrationEventStoreLive,
	OrchestrationCommandReceiptsLive
).pipe(Layer.provideMerge(MigratedSqlite))

const TestLive = OrchestrationEngineLive.pipe(
	Layer.provideMerge(PersistenceLive),
	Layer.provide(BunCrypto.layer)
)

const isolatedEngine = () => Layer.fresh(TestLive)

const HydrateLive = Layer.unwrap(
	Effect.gen(function*() {
		const store = yield* OrchestrationEventStore
		yield* store.append([projectCreated("event-preload")])
		return OrchestrationEngineLive
	})
).pipe(Layer.provideMerge(PersistenceLive), Layer.provide(BunCrypto.layer))

const hasMetricSnapshot = (
	snapshots: ReadonlyArray<Metric.Metric.Snapshot>,
	id: string,
	attributes: Readonly<Record<string, string>>
): boolean =>
	snapshots.some(
		(snapshot) =>
			snapshot.id === id &&
			Object.entries(attributes).every(([key, value]) => snapshot.attributes?.[key] === value)
	)

Vitest.layer(isolatedEngine())("accepted dispatch", (it) => {
	it.effect("appends events, advances the read model, and returns the sequence", () =>
		Effect.gen(function*() {
			const engine = yield* OrchestrationEngine
			const store = yield* OrchestrationEventStore
			const result = yield* engine.dispatch(createProjectCommand("cmd-1", "project-1"))
			Vitest.assert.strictEqual(result.sequence, 1)
			const latest = yield* engine.latestSequence
			Vitest.assert.strictEqual(latest, 1)
			const events = yield* Stream.runCollect(store.readFrom(0, 10))
			Vitest.assert.strictEqual(events.length, 1)
			Vitest.assert.strictEqual(events[0]?.type, "ProjectCreated")
			const duplicate = yield* Effect.flip(
				engine.dispatch(createProjectCommand("cmd-2", "project-1"))
			)
			Vitest.assert.strictEqual(duplicate._tag, "OrchestrationCommandInvariantError")
		})
	)
})

Vitest.layer(isolatedEngine())("accepted command replay", (it) => {
	it.effect("replays an accepted commandId without appending a second event", () =>
		Effect.gen(function*() {
			const engine = yield* OrchestrationEngine
			const store = yield* OrchestrationEventStore
			const command = createProjectCommand("cmd-replay", "project-replay")
			const first = yield* engine.dispatch(command)
			const second = yield* engine.dispatch(command)
			Vitest.assert.strictEqual(first.sequence, second.sequence)
			const events = yield* Stream.runCollect(store.readFrom(0, 10))
			Vitest.assert.strictEqual(events.length, 1)
		})
	)
})

Vitest.layer(isolatedEngine())("invariant failure", (it) => {
	it.effect("writes a rejection receipt, fails the Deferred, and does not append events", () =>
		Effect.gen(function*() {
			const engine = yield* OrchestrationEngine
			const store = yield* OrchestrationEventStore
			const receipts = yield* OrchestrationCommandReceipts
			const command = createSessionCommand("cmd-reject")
			const error = yield* Effect.flip(engine.dispatch(command))
			Vitest.assert.strictEqual(error._tag, "OrchestrationCommandInvariantError")
			Vitest.assert.isTrue(Schema.is(OrchestrationCommandInvariantError)(error))
			const events = yield* Stream.runCollect(store.readFrom(0, 10))
			Vitest.assert.deepStrictEqual(
				events.map((event) => event.eventId),
				[]
			)
			const stored = yield* receipts.getByCommandId(command.commandId)
			Vitest.assert.deepStrictEqual(
				stored,
				Option.some({
					commandId: command.commandId,
					status: "rejected" as const,
					reason: "Project 'project-1' does not exist for command 'session.create'."
				})
			)
			const latest = yield* engine.latestSequence
			Vitest.assert.strictEqual(latest, 0)
		})
	)

	it.effect("fails a previously rejected commandId without appending events", () =>
		Effect.gen(function*() {
			const engine = yield* OrchestrationEngine
			const store = yield* OrchestrationEventStore
			const command = createSessionCommand("cmd-reject-again")
			yield* Effect.flip(engine.dispatch(command))
			const error = yield* Effect.flip(engine.dispatch(command))
			Vitest.assert.strictEqual(error._tag, "OrchestrationCommandPreviouslyRejectedError")
			const events = yield* Stream.runCollect(store.readFrom(0, 10))
			Vitest.assert.strictEqual(events.length, 0)
		})
	)
})

Vitest.layer(isolatedEngine())("serialized dispatch", (it) => {
	it.effect("keeps every concurrent project.create in the read model", () =>
		Effect.gen(function*() {
			const engine = yield* OrchestrationEngine
			const store = yield* OrchestrationEventStore
			const results = yield* Effect.forEach(
				Arr.range(0, 19),
				(index) =>
					engine.dispatch(createProjectCommand(`cmd-concurrent-${index}`, `project-${index}`)),
				{ concurrency: "unbounded" }
			)
			Vitest.assert.strictEqual(results.length, 20)
			const latest = yield* engine.latestSequence
			Vitest.assert.strictEqual(latest, 20)
			const events = yield* Stream.runCollect(store.readFrom(0, 50))
			Vitest.assert.deepStrictEqual(
				Arr.sort(
					events.map((event) => event.sequence),
					Order.Number
				),
				Arr.range(1, 20)
			)
			yield* Effect.forEach(Arr.range(0, 19), (index) =>
				Effect.gen(function*() {
					const error = yield* Effect.flip(
						engine.dispatch(
							createProjectCommand(`cmd-exists-${index}`, `project-${index}`)
						)
					)
					Vitest.assert.strictEqual(error._tag, "OrchestrationCommandInvariantError")
				})
			)
		})
	)
})

Vitest.layer(isolatedEngine())("serialized same-id dispatch", (it) => {
	it.effect("accepts one concurrent project.create and rejects the rest", () =>
		Effect.gen(function*() {
			const engine = yield* OrchestrationEngine
			const store = yield* OrchestrationEventStore
			const exits = yield* Effect.forEach(
				Arr.range(0, 19),
				(index) =>
					Effect.exit(
						engine.dispatch(createProjectCommand(`cmd-same-${index}`, "project-same"))
					),
				{ concurrency: "unbounded" }
			)
			const accepted = Arr.filter(exits, Exit.isSuccess)
			Vitest.assert.strictEqual(accepted.length, 1)
			Vitest.assert.strictEqual(exits.length, 20)
			const latest = yield* engine.latestSequence
			Vitest.assert.strictEqual(latest, 1)
			const events = yield* Stream.runCollect(store.readFrom(0, 10))
			Vitest.assert.strictEqual(events.length, 1)
		})
	)
})

Vitest.layer(isolatedEngine())("domain event PubSub", (it) => {
	it.effect("publishes accepted events to subscribers", () =>
		Effect.gen(function*() {
			const engine = yield* OrchestrationEngine
			const fiber = yield* Stream.take(engine.streamDomainEvents, 1).pipe(
				Stream.runCollect,
				Effect.forkScoped
			)
			yield* TestClock.adjust(Duration.millis(50))
			yield* engine.dispatch(createProjectCommand("cmd-pubsub", "project-pubsub"))
			const events = yield* Fiber.join(fiber)
			Vitest.assert.strictEqual(events[0]?.type, "ProjectCreated")
		})
	)
})

Vitest.layer(isolatedEngine())("metrics", (it) => {
	it.effect("records command count, dispatch duration, and ack duration by command type", () =>
		Effect.gen(function*() {
			const engine = yield* OrchestrationEngine
			yield* engine.dispatch(createProjectCommand("cmd-metric", "project-metric"))
			yield* Effect.flip(engine.dispatch(createSessionCommand("cmd-metric-fail")))
			const snapshots = yield* Metric.snapshot
			Vitest.assert.isTrue(
				hasMetricSnapshot(snapshots, orchestrationCommandsTotal.id, {
					commandType: "project.create",
					outcome: "success"
				})
			)
			Vitest.assert.isTrue(
				hasMetricSnapshot(snapshots, orchestrationCommandsTotal.id, {
					commandType: "session.create",
					outcome: "failure"
				})
			)
			Vitest.assert.isTrue(
				hasMetricSnapshot(snapshots, orchestrationCommandDuration.id, {
					commandType: "project.create"
				})
			)
			Vitest.assert.isTrue(
				hasMetricSnapshot(snapshots, orchestrationCommandAckDuration.id, {
					commandType: "project.create"
				})
			)
		})
	)
})

Vitest.layer(Layer.fresh(HydrateLive))("hydrate from the event store", (it) => {
	it.effect("rebuilds the read model so a later command can see persisted state", () =>
		Effect.gen(function*() {
			const engine = yield* OrchestrationEngine
			const latest = yield* engine.latestSequence
			Vitest.assert.strictEqual(latest, 1)
			const result = yield* engine.dispatch(createSessionCommand("cmd-after-hydrate"))
			Vitest.assert.strictEqual(result.sequence, 2)
		})
	)
})

Vitest.it.effect("shutdown drains queued commands and completes their Deferreds", () =>
	Effect.gen(function*() {
		const testScope = yield* Effect.scope
		const fibers = yield* Effect.scoped(
			Effect.gen(function*() {
				const engine = yield* OrchestrationEngine
				const fibers = yield* Effect.forEach(
					Arr.range(0, 9),
					(index) =>
						Effect.forkIn(
							engine.dispatch(
								createProjectCommand(`cmd-drain-${index}`, `project-drain-${index}`)
							),
							testScope
						),
					{ concurrency: "unbounded" }
				)
				yield* TestClock.adjust(Duration.millis(50))
				return fibers
			}).pipe(
				// @effect-diagnostics-next-line strictEffectProvide:off
				// This test is an entry point: it must close the engine Scope to prove drain.
				Effect.provide(isolatedEngine())
			)
		)
		const results = yield* Fiber.joinAll(fibers)
		Vitest.assert.deepStrictEqual(
			Arr.sort(
				results.map((result) => result.sequence),
				Order.Number
			),
			Arr.range(1, 10)
		)
	})
)
