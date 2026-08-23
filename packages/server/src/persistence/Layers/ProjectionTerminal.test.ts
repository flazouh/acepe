import {
	CommandId,
	EventId,
	type OrchestrationEvent,
	SessionId,
	TerminalId,
	TrimmedNonEmptyString
} from "@acepe/contracts"
import * as BunFileSystem from "@effect/platform-bun/BunFileSystem"
import * as BunPath from "@effect/platform-bun/BunPath"
import * as Vitest from "@effect/vitest"
import * as Effect from "effect/Effect"
import * as FileSystem from "effect/FileSystem"
import * as Layer from "effect/Layer"
import * as Option from "effect/Option"
import * as Path from "effect/Path"
import * as Schema from "effect/Schema"
import * as SqlClient from "effect/unstable/sql/SqlClient"
import { runMigrations } from "../Migrations.ts"
import { ProjectionTerminal } from "../Services/ProjectionTerminal.ts"
import { ProjectionTerminalLive } from "./ProjectionTerminal.ts"
import { makeSqliteLayer } from "./Sqlite.ts"

const NOW = "2026-08-20T12:00:00.000Z"
const commandId = CommandId.make("cmd-1")
const sessionId = SessionId.make("session-1")
const terminalId = TerminalId.make("term-1")

const terminalEvent = (
	type: "TerminalOpened" | "TerminalOutputAppended" | "TerminalClosed",
	sequence: number,
	output: string,
	closed: boolean
): OrchestrationEvent => ({
	sequence,
	eventId: EventId.make(`event-${sequence}`),
	aggregateKind: "terminal",
	aggregateId: terminalId,
	occurredAt: NOW,
	commandId,
	causationEventId: null,
	correlationId: commandId,
	metadata: {},
	type,
	payload: {
		terminalId,
		sessionId,
		cwd: "/tmp",
		cols: 80,
		rows: 24,
		output,
		closed
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

const TerminalLive = ProjectionTerminalLive.pipe(Layer.provideMerge(MigratedSqlite))

Vitest.layer(Layer.fresh(TerminalLive))("ProjectionTerminalLive", (it) => {
	it.effect("upserts a terminal row from TerminalOpened, then replaces it wholesale on TerminalOutputAppended", () =>
		Effect.gen(function*() {
			const sql = yield* SqlClient.SqlClient
			const projection = yield* ProjectionTerminal
			yield* sql.withTransaction(projection.apply(terminalEvent("TerminalOpened", 1, "", false), sql))
			const opened = yield* projection.get(terminalId)
			Vitest.assert.strictEqual(Option.isSome(opened), true)
			if (Option.isSome(opened)) {
				Vitest.assert.strictEqual(opened.value.output, "")
				Vitest.assert.strictEqual(opened.value.closed, false)
			}
			yield* sql.withTransaction(
				projection.apply(terminalEvent("TerminalOutputAppended", 2, "hi\n", false), sql)
			)
			const appended = yield* projection.get(terminalId)
			Vitest.assert.strictEqual(Option.isSome(appended), true)
			if (Option.isSome(appended)) {
				Vitest.assert.strictEqual(appended.value.output, "hi\n")
				Vitest.assert.strictEqual(appended.value.sequence, 2)
			}
		})
	)

	it.effect("marks closed on TerminalClosed", () =>
		Effect.gen(function*() {
			const sql = yield* SqlClient.SqlClient
			const projection = yield* ProjectionTerminal
			yield* sql.withTransaction(projection.apply(terminalEvent("TerminalOpened", 1, "", false), sql))
			yield* sql.withTransaction(projection.apply(terminalEvent("TerminalClosed", 2, "bye\n", true), sql))
			const closed = yield* projection.get(terminalId)
			Vitest.assert.strictEqual(Option.isSome(closed), true)
			if (Option.isSome(closed)) {
				Vitest.assert.strictEqual(closed.value.closed, true)
			}
		})
	)

	it.effect("ignores events for other aggregate kinds", () =>
		Effect.gen(function*() {
			// A fresh terminal id: earlier cases in this block already wrote a
			// row for `terminalId` (see the shared-layer note above), so reusing
			// it here would find that row regardless of whether this event was
			// ignored.
			const untouchedTerminalId = TerminalId.make("term-untouched")
			const sql = yield* SqlClient.SqlClient
			const projection = yield* ProjectionTerminal
			const unrelated: OrchestrationEvent = {
				sequence: 1,
				eventId: EventId.make("event-1"),
				aggregateKind: "session",
				aggregateId: sessionId,
				occurredAt: NOW,
				commandId,
				causationEventId: null,
				correlationId: commandId,
				metadata: {},
				type: "SessionArchived",
				payload: { sessionId }
			}
			yield* sql.withTransaction(projection.apply(unrelated, sql))
			const found = yield* projection.get(untouchedTerminalId)
			Vitest.assert.strictEqual(Option.isNone(found), true)
		})
	)
})

Vitest.describe("ProjectionTerminalLive name", () => {
	Vitest.it.effect("decodes the projector name", () =>
		Effect.gen(function*() {
			const name = yield* Schema.decodeUnknownEffect(TrimmedNonEmptyString)("projection.terminal")
			Vitest.assert.strictEqual(name, "projection.terminal")
		})
	)
})
