import { CommandId, EventId, ProjectId } from "@acepe/contracts"
import * as BunFileSystem from "@effect/platform-bun/BunFileSystem"
import * as BunPath from "@effect/platform-bun/BunPath"
import * as Vitest from "@effect/vitest"
import * as Effect from "effect/Effect"
import * as FileSystem from "effect/FileSystem"
import * as Layer from "effect/Layer"
import * as Option from "effect/Option"
import * as Path from "effect/Path"
import * as Schema from "effect/Schema"
import * as Stream from "effect/Stream"
import * as SqlClient from "effect/unstable/sql/SqlClient"
import { runMigrations } from "../Migrations.ts"
import { type NewOrchestrationEvent, OrchestrationEventStore } from "../Services/OrchestrationEventStore.ts"
import {
	OrchestrationCommandPreviouslyRejectedError,
	OrchestrationCommandReceipts
} from "../Services/OrchestrationCommandReceipts.ts"
import { OrchestrationEventStoreLive } from "./OrchestrationEventStore.ts"
import { OrchestrationCommandReceiptsLive } from "./OrchestrationCommandReceipts.ts"
import { makeSqliteLayer } from "./Sqlite.ts"

class ForcedRollback extends Schema.TaggedError<ForcedRollback>()("ForcedRollback", {}) {}

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

const TestLive = Layer.mergeAll(OrchestrationCommandReceiptsLive, OrchestrationEventStoreLive).pipe(
	Layer.provideMerge(MigratedSqlite)
)

const isolatedLive = () => Layer.fresh(TestLive)

const dispatchAccepted = (events: ReadonlyArray<NewOrchestrationEvent>) =>
	Effect.gen(function*() {
		const sql = yield* SqlClient.SqlClient
		const receipts = yield* OrchestrationCommandReceipts
		const store = yield* OrchestrationEventStore
		const replayed = yield* receipts.replay(commandId)
		if (Option.isSome(replayed)) {
			return replayed.value
		}
		return yield* sql.withTransaction(
			Effect.gen(function*() {
				const sequence = yield* store.append(events)
				yield* receipts.record({
					commandId,
					status: "accepted",
					sequence
				})
				return sequence
			})
		)
	})

Vitest.layer(isolatedLive())("record and getByCommandId", (it) => {
	it.effect("round-trips an accepted receipt", () =>
		Effect.gen(function*() {
			const receipts = yield* OrchestrationCommandReceipts
			const acceptedCommandId = CommandId.make("cmd-accepted")
			yield* receipts.record({
				commandId: acceptedCommandId,
				status: "accepted",
				sequence: 7
			})
			const stored = yield* receipts.getByCommandId(acceptedCommandId)
			Vitest.assert.deepStrictEqual(
				stored,
				Option.some({
					commandId: acceptedCommandId,
					status: "accepted" as const,
					sequence: 7
				})
			)
		})
	)

	it.effect("round-trips a rejected receipt", () =>
		Effect.gen(function*() {
			const receipts = yield* OrchestrationCommandReceipts
			const rejectedCommandId = CommandId.make("cmd-rejected")
			yield* receipts.record({
				commandId: rejectedCommandId,
				status: "rejected",
				reason: "project already exists"
			})
			const stored = yield* receipts.getByCommandId(rejectedCommandId)
			Vitest.assert.deepStrictEqual(
				stored,
				Option.some({
					commandId: rejectedCommandId,
					status: "rejected" as const,
					reason: "project already exists"
				})
			)
		})
	)
})

Vitest.layer(isolatedLive())("re-dispatch accepted commandId", (it) => {
	it.effect("returns the original sequence and appends no new events", () =>
		Effect.gen(function*() {
			const store = yield* OrchestrationEventStore
			const first = yield* dispatchAccepted([projectCreated("event-a")])
			const second = yield* dispatchAccepted([projectCreated("event-b")])
			Vitest.assert.strictEqual(first, 1)
			Vitest.assert.strictEqual(second, 1)
			const events = yield* Stream.runCollect(store.readFrom(0, 10))
			Vitest.assert.deepStrictEqual(
				events.map((event) => event.eventId),
				["event-a"]
			)
			Vitest.assert.deepStrictEqual(
				events.map((event) => event.sequence),
				[1]
			)
		})
	)
})

Vitest.layer(isolatedLive())("re-dispatch rejected commandId", (it) => {
	it.effect("fails with OrchestrationCommandPreviouslyRejectedError and appends nothing", () =>
		Effect.gen(function*() {
			const receipts = yield* OrchestrationCommandReceipts
			const store = yield* OrchestrationEventStore
			yield* receipts.record({
				commandId,
				status: "rejected",
				reason: "project already exists"
			})
			const error = yield* receipts.replay(commandId).pipe(Effect.flip)
			Vitest.assert.strictEqual(error._tag, "OrchestrationCommandPreviouslyRejectedError")
			Vitest.assert.isTrue(Schema.is(OrchestrationCommandPreviouslyRejectedError)(error))
			if (error._tag === "OrchestrationCommandPreviouslyRejectedError") {
				Vitest.assert.strictEqual(error.reason, "project already exists")
			}
			const events = yield* Stream.runCollect(store.readFrom(0, 10))
			Vitest.assert.deepStrictEqual(
				events.map((event) => event.eventId),
				[]
			)
		})
	)
})

Vitest.layer(isolatedLive())("receipts share the event transaction", (it) => {
	it.effect("rolls back the receipt when the event append transaction fails", () =>
		Effect.gen(function*() {
			const sql = yield* SqlClient.SqlClient
			const receipts = yield* OrchestrationCommandReceipts
			const store = yield* OrchestrationEventStore
			const error = yield* sql
				.withTransaction(
					Effect.gen(function*() {
						const sequence = yield* store.append([projectCreated("event-a")])
						yield* receipts.record({
							commandId,
							status: "accepted",
							sequence
						})
						return yield* new ForcedRollback()
					})
				)
				.pipe(Effect.flip)
			Vitest.assert.strictEqual(error._tag, "ForcedRollback")
			const stored = yield* receipts.getByCommandId(commandId)
			Vitest.assert.deepStrictEqual(stored, Option.none())
			const events = yield* Stream.runCollect(store.readFrom(0, 10))
			Vitest.assert.deepStrictEqual(
				events.map((event) => event.eventId),
				[]
			)
		})
	)

	it.effect("commits the receipt with the events it describes", () =>
		Effect.gen(function*() {
			const sql = yield* SqlClient.SqlClient
			const receipts = yield* OrchestrationCommandReceipts
			const store = yield* OrchestrationEventStore
			const sequence = yield* sql.withTransaction(
				Effect.gen(function*() {
					const lastSequence = yield* store.append([projectCreated("event-a")])
					yield* receipts.record({
						commandId,
						status: "accepted",
						sequence: lastSequence
					})
					return lastSequence
				})
			)
			Vitest.assert.strictEqual(sequence, 1)
			const stored = yield* receipts.getByCommandId(commandId)
			Vitest.assert.deepStrictEqual(
				stored,
				Option.some({
					commandId,
					status: "accepted" as const,
					sequence: 1
				})
			)
			const events = yield* Stream.runCollect(store.readFrom(0, 10))
			Vitest.assert.deepStrictEqual(
				events.map((event) => event.eventId),
				["event-a"]
			)
		})
	)
})
