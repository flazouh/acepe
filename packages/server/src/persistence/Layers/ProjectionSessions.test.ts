import {
	CommandId,
	EventId,
	MessageId,
	type OrchestrationEvent,
	ProjectId,
	SessionId
} from "@acepe/contracts"
import * as BunCrypto from "@effect/platform-bun/BunCrypto"
import * as BunFileSystem from "@effect/platform-bun/BunFileSystem"
import * as BunPath from "@effect/platform-bun/BunPath"
import * as Vitest from "@effect/vitest"
import * as Duration from "effect/Duration"
import * as Effect from "effect/Effect"
import * as FileSystem from "effect/FileSystem"
import * as Layer from "effect/Layer"
import * as Option from "effect/Option"
import * as Path from "effect/Path"
import * as Schema from "effect/Schema"
import * as TestClock from "effect/testing/TestClock"
import * as SqlClient from "effect/unstable/sql/SqlClient"
import { OrchestrationEngineLive } from "../../orchestration/Layers/OrchestrationEngine.ts"
import { ProjectionPipelineLive } from "../../orchestration/Layers/ProjectionPipeline.ts"
import {
	type ProjectorDefinition,
	ProjectionApplyError,
	ProjectionPipeline
} from "../../orchestration/Services/ProjectionPipeline.ts"
import { runMigrations } from "../Migrations.ts"
import { type NewOrchestrationEvent, OrchestrationEventStore } from "../Services/OrchestrationEventStore.ts"
import { ProjectionSessions } from "../Services/ProjectionSessions.ts"
import { ProjectionState } from "../Services/ProjectionState.ts"
import { OrchestrationCommandReceiptsLive } from "./OrchestrationCommandReceipts.ts"
import { OrchestrationEventStoreLive } from "./OrchestrationEventStore.ts"
import { ProjectionSessionsLive } from "./ProjectionSessions.ts"
import { ProjectionStateLive } from "./ProjectionState.ts"
import { makeSqliteLayer } from "./Sqlite.ts"

const NOW = "2026-08-20T12:00:00.000Z"
const LATER = "2026-08-20T12:00:01.000Z"
const commandId = CommandId.make("cmd-1")
const projectId = ProjectId.make("project-1")
const otherProjectId = ProjectId.make("project-2")
const sessionId = SessionId.make("session-1")
const sessionTwoId = SessionId.make("session-2")
const messageId = MessageId.make("message-1")

type SessionEventType = Extract<
	OrchestrationEvent["type"],
	| "SessionCreated"
	| "SessionMetaUpdated"
	| "SessionArchived"
	| "SessionUnarchived"
	| "SessionDeleted"
	| "MessageSent"
	| "TurnCancelled"
>

const sessionEvent = <const Type extends SessionEventType, Payload>(
	sequence: number,
	type: Type,
	occurredAt: string,
	payload: Payload,
	aggregateId: SessionId = sessionId
) => ({
	sequence,
	eventId: EventId.make(`event-${sequence}`),
	aggregateKind: "session" as const,
	aggregateId,
	occurredAt,
	commandId,
	causationEventId: null,
	correlationId: commandId,
	metadata: {},
	type,
	payload
})

const projectCreatedEvent = (sequence: number): OrchestrationEvent => ({
	sequence,
	eventId: EventId.make(`event-${sequence}`),
	aggregateKind: "project",
	aggregateId: projectId,
	occurredAt: NOW,
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

const DumpRow = Schema.Struct({
	session_id: Schema.String,
	project_id: Schema.String,
	title: Schema.String,
	provider: Schema.NullOr(Schema.String),
	created_at: Schema.String,
	updated_at: Schema.String,
	last_activity_at: Schema.String,
	archived_at: Schema.NullOr(Schema.String),
	deleted_at: Schema.NullOr(Schema.String),
	pr_number: Schema.NullOr(Schema.Int),
	pr_link_mode: Schema.NullOr(Schema.String)
})
const decodeDumpRows = Schema.decodeUnknownEffect(Schema.Array(DumpRow))

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

const SessionsLive = ProjectionSessionsLive.pipe(Layer.provideMerge(MigratedSqlite))

const isolatedSessions = () => Layer.fresh(SessionsLive)

const PersistenceLive = Layer.mergeAll(
	OrchestrationEventStoreLive,
	OrchestrationCommandReceiptsLive,
	ProjectionStateLive,
	ProjectionSessionsLive
).pipe(Layer.provideMerge(MigratedSqlite))

const EngineLive = OrchestrationEngineLive.pipe(
	Layer.provideMerge(PersistenceLive),
	Layer.provide(BunCrypto.layer)
)

const isolatedEngine = () => Layer.fresh(EngineLive)

const dumpTable = Effect.fn("dumpProjectionSessions")(function*() {
	const sql = yield* SqlClient.SqlClient
	const rows = yield* sql`
		SELECT
			session_id,
			project_id,
			title,
			provider,
			created_at,
			updated_at,
			last_activity_at,
			archived_at,
			deleted_at,
			pr_number,
			pr_link_mode
		FROM projection_sessions
		ORDER BY session_id ASC
	`.withoutTransform
	return yield* decodeDumpRows(rows)
})

const projectorOf = (sessions: {
	readonly name: ProjectorDefinition["name"]
	readonly apply: ProjectorDefinition["apply"]
	readonly truncate: ProjectorDefinition["truncate"]
}): ProjectorDefinition => ({
	name: sessions.name,
	apply: sessions.apply,
	truncate: sessions.truncate
})

const withPipeline = <A, E, R>(
	projectors: ReadonlyArray<ProjectorDefinition>,
	body: Effect.Effect<A, E, R>
) =>
	Effect.scoped(
		body.pipe(
			// @effect-diagnostics-next-line strictEffectProvide:off
			Effect.provide(Layer.fresh(ProjectionPipelineLive(projectors)))
		)
	)

const waitForSequence = Effect.fn("waitForSequence")(function*(name: string, sequence: number) {
	const state = yield* ProjectionState
	const pipeline = yield* ProjectionPipeline
	let spins = 0
	while (true) {
		const current = yield* state.lastApplied(name)
		if (current === sequence) {
			return
		}
		spins = spins + 1
		if (spins > 200) {
			const health = yield* pipeline.health(name)
			return yield* new ProjectionApplyError({
				name,
				detail: `Timed out waiting for sequence ${sequence}; lastApplied=${current}; health=${health}.`
			})
		}
		yield* TestClock.adjust(Duration.millis(1))
		yield* Effect.yieldNow
	}
})

const seedLog = (): ReadonlyArray<NewOrchestrationEvent> => [
	{
		eventId: EventId.make("event-1"),
		aggregateKind: "project",
		aggregateId: projectId,
		occurredAt: NOW,
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
	},
	{
		eventId: EventId.make("event-2"),
		aggregateKind: "session",
		aggregateId: sessionId,
		occurredAt: NOW,
		commandId,
		causationEventId: null,
		correlationId: commandId,
		metadata: {},
		type: "SessionCreated",
		payload: {
			sessionId,
			projectId,
			title: "New Thread"
		}
	},
	{
		eventId: EventId.make("event-3"),
		aggregateKind: "session",
		aggregateId: sessionTwoId,
		occurredAt: NOW,
		commandId,
		causationEventId: null,
		correlationId: commandId,
		metadata: {},
		type: "SessionCreated",
		payload: {
			sessionId: sessionTwoId,
			projectId,
			title: "Keep this title"
		}
	},
	{
		eventId: EventId.make("event-4"),
		aggregateKind: "session",
		aggregateId: sessionId,
		occurredAt: LATER,
		commandId,
		causationEventId: null,
		correlationId: commandId,
		metadata: {},
		type: "MessageSent",
		payload: {
			sessionId,
			messageId,
			text: "Ship the lifecycle slice"
		}
	},
	{
		eventId: EventId.make("event-5"),
		aggregateKind: "session",
		aggregateId: sessionId,
		occurredAt: LATER,
		commandId,
		causationEventId: null,
		correlationId: commandId,
		metadata: {},
		type: "SessionArchived",
		payload: {
			sessionId
		}
	},
	{
		eventId: EventId.make("event-6"),
		aggregateKind: "session",
		aggregateId: sessionTwoId,
		occurredAt: LATER,
		commandId,
		causationEventId: null,
		correlationId: commandId,
		metadata: {},
		type: "SessionDeleted",
		payload: {
			sessionId: sessionTwoId
		}
	}
]

Vitest.layer(isolatedSessions())("one row per session", (it) => {
	it.effect("inserts a session row and ignores project events", () =>
		Effect.gen(function*() {
			const sql = yield* SqlClient.SqlClient
			const sessions = yield* ProjectionSessions
			yield* sessions.apply(projectCreatedEvent(1), sql)
			yield* sessions.apply(
				sessionEvent(2, "SessionCreated", NOW, {
					sessionId,
					projectId,
					title: "First session"
				}),
				sql
			)
			yield* sessions.apply(
				sessionEvent(
					3,
					"SessionCreated",
					NOW,
					{
						sessionId: sessionTwoId,
						projectId,
						title: "Second session"
					},
					sessionTwoId
				),
				sql
			)
			const rows = yield* dumpTable()
			Vitest.assert.deepStrictEqual(
				rows.map((row) => row.session_id),
				["session-1", "session-2"]
			)
			Vitest.assert.strictEqual(rows[0]?.provider, null)
			Vitest.assert.strictEqual(rows[0]?.project_id, "project-1")
		})
	)
})

Vitest.layer(isolatedSessions())("session title rules", (it) => {
	it.effect("strips artifacts and falls back to the first user message", () =>
		Effect.gen(function*() {
			const sql = yield* SqlClient.SqlClient
			const sessions = yield* ProjectionSessions
			yield* sessions.apply(
				sessionEvent(1, "SessionCreated", NOW, {
					sessionId,
					projectId,
					title: "New Thread"
				}),
				sql
			)
			yield* sessions.apply(
				sessionEvent(2, "MessageSent", LATER, {
					sessionId,
					messageId,
					text: "<ide_opened_file>File.ts</ide_opened_file>Implement auth flow\nwith OAuth"
				}),
				sql
			)
			const row = yield* sessions.get(sessionId)
			const session = Option.match(row, {
				onNone: () => {
					Vitest.assert.fail("expected a projected session")
					return undefined as never
				},
				onSome: (value) => value
			})
			Vitest.assert.strictEqual(session.title, "Implement auth flow")
		})
	)
})

Vitest.layer(isolatedSessions())("listForProject", (it) => {
	it.effect("returns only the selected project's sessions, including archived and deleted", () =>
		Effect.gen(function*() {
			const sql = yield* SqlClient.SqlClient
			const sessions = yield* ProjectionSessions
			yield* sessions.apply(
				sessionEvent(1, "SessionCreated", NOW, {
					sessionId,
					projectId,
					title: "First session"
				}),
				sql
			)
			yield* sessions.apply(
				sessionEvent(2, "SessionArchived", LATER, {
					sessionId
				}),
				sql
			)
			yield* sessions.apply(
				sessionEvent(
					3,
					"SessionCreated",
					NOW,
					{
						sessionId: sessionTwoId,
						projectId: otherProjectId,
						title: "Other project session"
					},
					sessionTwoId
				),
				sql
			)
			const listed = yield* sessions.listForProject(projectId)
			Vitest.assert.strictEqual(listed.length, 1)
			Vitest.assert.strictEqual(listed[0]?.sessionId, sessionId)
			Vitest.assert.strictEqual(listed[0]?.archivedAt, LATER)
			Vitest.assert.strictEqual(listed[0]?.deletedAt, null)
			const otherListed = yield* sessions.listForProject(otherProjectId)
			Vitest.assert.strictEqual(otherListed.length, 1)
			Vitest.assert.strictEqual(otherListed[0]?.sessionId, sessionTwoId)
		})
	)
})

Vitest.layer(isolatedSessions())("archived and deleted stay in the table", (it) => {
	it.effect("sets archived_at and deleted_at on the existing row", () =>
		Effect.gen(function*() {
			const sql = yield* SqlClient.SqlClient
			const sessions = yield* ProjectionSessions
			yield* sessions.apply(
				sessionEvent(1, "SessionCreated", NOW, {
					sessionId,
					projectId,
					title: "First session"
				}),
				sql
			)
			yield* sessions.apply(
				sessionEvent(2, "SessionArchived", LATER, {
					sessionId
				}),
				sql
			)
			yield* sessions.apply(
				sessionEvent(3, "SessionDeleted", LATER, {
					sessionId
				}),
				sql
			)
			const rows = yield* dumpTable()
			Vitest.assert.strictEqual(rows.length, 1)
			Vitest.assert.strictEqual(rows[0]?.archived_at, LATER)
			Vitest.assert.strictEqual(rows[0]?.deleted_at, LATER)
			const listed = yield* sessions.list()
			Vitest.assert.strictEqual(listed.length, 1)
			Vitest.assert.strictEqual(listed[0]?.archivedAt, LATER)
			Vitest.assert.strictEqual(listed[0]?.deletedAt, LATER)
		})
	)
})

Vitest.layer(isolatedSessions())("pull-request link", (it) => {
	it.effect("stores pr_number and pr_link_mode from SessionMetaUpdated", () =>
		Effect.gen(function*() {
			const sql = yield* SqlClient.SqlClient
			const sessions = yield* ProjectionSessions
			yield* sessions.apply(
				sessionEvent(1, "SessionCreated", NOW, {
					sessionId,
					projectId,
					title: "First session"
				}),
				sql
			)
			yield* sessions.apply(
				sessionEvent(2, "SessionMetaUpdated", LATER, {
					sessionId,
					prNumber: 42,
					prLinkMode: "manual" as const
				}),
				sql
			)
			const row = yield* sessions.get(sessionId)
			const session = Option.match(row, {
				onNone: () => {
					Vitest.assert.fail("expected a projected session")
					return undefined as never
				},
				onSome: (value) => value
			})
			Vitest.assert.strictEqual(session.prNumber, 42)
			Vitest.assert.strictEqual(session.prLinkMode, "manual")
		})
	)
})

Vitest.layer(isolatedSessions())("truncate", (it) => {
	it.effect("clears every projection_sessions row", () =>
		Effect.gen(function*() {
			const sql = yield* SqlClient.SqlClient
			const sessions = yield* ProjectionSessions
			yield* sessions.apply(
				sessionEvent(1, "SessionCreated", NOW, {
					sessionId,
					projectId,
					title: "First session"
				}),
				sql
			)
			yield* sessions.truncate(sql)
			const rows = yield* dumpTable()
			Vitest.assert.deepStrictEqual(rows, [])
		})
	)
})

Vitest.layer(isolatedEngine())("rebuild projection.sessions", (it) => {
	it.effect("reproduces the table byte-identically from the same event log", () =>
		Effect.gen(function*() {
			const store = yield* OrchestrationEventStore
			const sessions = yield* ProjectionSessions
			const sql = yield* SqlClient.SqlClient
			yield* store.append(seedLog())
			const original = yield* withPipeline(
				[projectorOf(sessions)],
				Effect.gen(function*() {
					yield* waitForSequence(sessions.name, 6)
					return yield* dumpTable()
				})
			)
			Vitest.assert.deepStrictEqual(
				original.map((row) => ({
					session_id: row.session_id,
					title: row.title,
					archived_at: row.archived_at,
					deleted_at: row.deleted_at,
					provider: row.provider
				})),
				[
					{
						session_id: "session-1",
						title: "Ship the lifecycle slice",
						archived_at: LATER,
						deleted_at: null,
						provider: null
					},
					{
						session_id: "session-2",
						title: "Keep this title",
						archived_at: null,
						deleted_at: LATER,
						provider: null
					}
				]
			)
			yield* sql`
				UPDATE projection_sessions
				SET title = 'bogus'
				WHERE session_id = ${sessionId}
			`.withoutTransform
			const rebuilt = yield* withPipeline(
				[projectorOf(sessions)],
				Effect.gen(function*() {
					const pipeline = yield* ProjectionPipeline
					yield* pipeline.rebuild(sessions.name)
					yield* waitForSequence(sessions.name, 6)
					return yield* dumpTable()
				})
			)
			Vitest.assert.deepStrictEqual(rebuilt, original)
		})
	)
})
