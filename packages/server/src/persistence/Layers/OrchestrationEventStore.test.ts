import { CommandId, EventId, ProjectId } from "@acepe/contracts"
import * as BunFileSystem from "@effect/platform-bun/BunFileSystem"
import * as BunPath from "@effect/platform-bun/BunPath"
import * as Vitest from "@effect/vitest"
import * as Arr from "effect/Array"
import * as Effect from "effect/Effect"
import * as Fiber from "effect/Fiber"
import * as FileSystem from "effect/FileSystem"
import * as Layer from "effect/Layer"
import * as Order from "effect/Order"
import * as Path from "effect/Path"
import * as Schema from "effect/Schema"
import * as Stream from "effect/Stream"
import * as SqlClient from "effect/unstable/sql/SqlClient"
import { runMigrations } from "../Migrations.ts"
import { type NewOrchestrationEvent, OrchestrationEventStore } from "../Services/OrchestrationEventStore.ts"
import { OrchestrationEventStoreLive } from "./OrchestrationEventStore.ts"
import { makeSqliteLayer } from "./Sqlite.ts"

const occurredAt = "2026-08-20T12:00:00.000Z"
const commandId = CommandId.make("cmd-1")
const projectId = ProjectId.make("project-1")

const projectCreated = (eventId: string): NewOrchestrationEvent => ({
	eventId: EventId.make(eventId),
	aggregateKind: "project",
	aggregateId: projectId,
	occurredAt,
	commandId,
	causationEventId: null,
	correlationId: commandId,
	metadata: {},
	type: "ProjectCreated",
	payload: {
		projectId,
		title: "Acepe",
		workspaceRoot: "/tmp/acepe"
	}
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

const TestStore = OrchestrationEventStoreLive.pipe(Layer.provideMerge(MigratedSqlite))

const isolatedStore = () => Layer.fresh(TestStore)

Vitest.layer(isolatedStore())("append assigns sequences in one transaction", (it) => {
	it.effect("returns the last sequence and stores events in order", () =>
		Effect.gen(function*() {
			const store = yield* OrchestrationEventStore
			const last = yield* store.append([
				projectCreated("event-a"),
				projectCreated("event-b"),
				projectCreated("event-c")
			])
			Vitest.assert.strictEqual(last, 3)
			const events = yield* Stream.runCollect(store.readFrom(0, 10))
			Vitest.assert.deepStrictEqual(
				events.map((event) => event.sequence),
				[1, 2, 3]
			)
			Vitest.assert.deepStrictEqual(
				events.map((event) => event.eventId),
				["event-a", "event-b", "event-c"]
			)
		})
	)
})

Vitest.layer(isolatedStore())("readFrom returns later events", (it) => {
	it.effect("streams decoded events after the given sequence", () =>
		Effect.gen(function*() {
			const store = yield* OrchestrationEventStore
			yield* store.append([
				projectCreated("event-a"),
				projectCreated("event-b"),
				projectCreated("event-c")
			])
			const events = yield* Stream.runCollect(store.readFrom(1, 10))
			Vitest.assert.deepStrictEqual(
				events.map((event) => event.sequence),
				[2, 3]
			)
		})
	)
})

Vitest.layer(isolatedStore())("concurrent appends", (it) => {
	it.effect("assigns sequences 1..N with no duplicates or gaps", () =>
		Effect.gen(function*() {
			const store = yield* OrchestrationEventStore
			const fibers = yield* Effect.forEach(
				Arr.range(0, 49),
				(index) => Effect.forkChild(store.append([projectCreated(`concurrent-${index}`)]))
			)
			const lastSequences = yield* Fiber.joinAll(fibers)
			Vitest.assert.deepStrictEqual(Arr.sort(lastSequences, Order.Number), Arr.range(1, 50))
			const events = yield* Stream.runCollect(store.readFrom(0, 50))
			Vitest.assert.deepStrictEqual(
				events.map((event) => event.sequence),
				Arr.range(1, 50)
			)
		})
	)
})

Vitest.layer(isolatedStore())("decode failures", (it) => {
	it.effect("surface as SchemaError on readFrom", () =>
		Effect.gen(function*() {
			const sql = yield* SqlClient.SqlClient
			yield* sql`
				INSERT INTO orchestration_events (
					sequence,
					event_id,
					aggregate_kind,
					aggregate_id,
					occurred_at,
					command_id,
					causation_event_id,
					correlation_id,
					metadata,
					type,
					payload
				) VALUES (
					1,
					'event-bad',
					'project',
					'project-1',
					${occurredAt},
					'cmd-1',
					NULL,
					'cmd-1',
					'{}',
					'ProjectCreated',
					'not-json'
				)
			`.withoutTransform
			const store = yield* OrchestrationEventStore
			const error = yield* Stream.runCollect(store.readFrom(0, 10)).pipe(Effect.flip)
			Vitest.assert.strictEqual(error._tag, "SchemaError")
			Vitest.assert.isTrue(Schema.isSchemaError(error))
		})
	)
})
