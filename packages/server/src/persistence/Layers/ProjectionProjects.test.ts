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
import { ProjectionSnapshotQueryLive } from "../../orchestration/Layers/ProjectionSnapshotQuery.ts"
import {
	type ProjectorDefinition,
	ProjectionApplyError,
	ProjectionPipeline
} from "../../orchestration/Services/ProjectionPipeline.ts"
import { ProjectionSnapshotQuery } from "../../orchestration/Services/ProjectionSnapshotQuery.ts"
import { runMigrations } from "../Migrations.ts"
import { type NewOrchestrationEvent, OrchestrationEventStore } from "../Services/OrchestrationEventStore.ts"
import { isScanWarmed, ProjectionProjects } from "../Services/ProjectionProjects.ts"
import { ProjectionState } from "../Services/ProjectionState.ts"
import { OrchestrationCommandReceiptsLive } from "./OrchestrationCommandReceipts.ts"
import { OrchestrationEventStoreLive } from "./OrchestrationEventStore.ts"
import { ProjectionProjectsLive } from "./ProjectionProjects.ts"
import { ProjectionStateLive } from "./ProjectionState.ts"
import { makeSqliteLayer } from "./Sqlite.ts"

const NOW = "2026-08-20T12:00:00.000Z"
const LATER = "2026-08-20T12:00:01.000Z"
const END = "2026-08-20T12:00:02.000Z"
const commandId = CommandId.make("cmd-1")
const projectId = ProjectId.make("project-1")
const sessionId = SessionId.make("session-1")
const sessionTwoId = SessionId.make("session-2")
const messageId = MessageId.make("message-1")

type ProjectEventType = Extract<
	OrchestrationEvent["type"],
	"ProjectCreated" | "ProjectMetaUpdated" | "ProjectDeleted"
>

type SessionEventType = Extract<
	OrchestrationEvent["type"],
	"SessionCreated" | "SessionArchived" | "SessionDeleted" | "MessageSent"
>

const projectEvent = <const Type extends ProjectEventType, Payload>(
	sequence: number,
	type: Type,
	occurredAt: string,
	payload: Payload
) => ({
	sequence,
	eventId: EventId.make(`event-${sequence}`),
	aggregateKind: "project" as const,
	aggregateId: projectId,
	occurredAt,
	commandId,
	causationEventId: null,
	correlationId: commandId,
	metadata: {},
	type,
	payload
})

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

const DumpRow = Schema.Struct({
	project_id: Schema.String,
	title: Schema.String,
	workspace_root: Schema.String,
	created_at: Schema.String,
	updated_at: Schema.String,
	deleted_at: Schema.NullOr(Schema.String),
	session_count: Schema.Number,
	scan_warmed_at: Schema.String
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

const ProjectsLive = ProjectionProjectsLive.pipe(Layer.provideMerge(MigratedSqlite))

const isolatedProjects = () => Layer.fresh(ProjectsLive)

const SnapshotLive = Layer.mergeAll(ProjectionProjectsLive, ProjectionSnapshotQueryLive).pipe(
	Layer.provideMerge(MigratedSqlite)
)

const isolatedSnapshot = () => Layer.fresh(SnapshotLive)

const PersistenceLive = Layer.mergeAll(
	OrchestrationEventStoreLive,
	OrchestrationCommandReceiptsLive,
	ProjectionStateLive,
	ProjectionProjectsLive
).pipe(Layer.provideMerge(MigratedSqlite))

const EngineLive = OrchestrationEngineLive.pipe(
	Layer.provideMerge(PersistenceLive),
	Layer.provide(BunCrypto.layer)
)

const isolatedEngine = () => Layer.fresh(EngineLive)

const dumpTable = Effect.fn("dumpProjectionProjects")(function*() {
	const sql = yield* SqlClient.SqlClient
	const rows = yield* sql`
		SELECT
			project_id,
			title,
			workspace_root,
			created_at,
			updated_at,
			deleted_at,
			session_count,
			scan_warmed_at
		FROM projection_projects
		ORDER BY project_id ASC
	`.withoutTransform
	return yield* decodeDumpRows(rows)
})

const projectorOf = (projects: {
	readonly name: ProjectorDefinition["name"]
	readonly apply: ProjectorDefinition["apply"]
	readonly truncate: ProjectorDefinition["truncate"]
}): ProjectorDefinition => ({
	name: projects.name,
	apply: projects.apply,
	truncate: projects.truncate
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

const checkpoint = Effect.fn("checkpoint")(function*(name: string, sequence: number) {
	const sql = yield* SqlClient.SqlClient
	yield* sql`
		INSERT INTO projection_state (name, last_applied_sequence)
		VALUES (${name}, ${sequence})
		ON CONFLICT(name) DO UPDATE SET
			last_applied_sequence = excluded.last_applied_sequence
	`.withoutTransform.pipe(Effect.asVoid)
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
			title: "First session"
		}
	},
	{
		eventId: EventId.make("event-3"),
		aggregateKind: "session",
		aggregateId: sessionTwoId,
		occurredAt: LATER,
		commandId,
		causationEventId: null,
		correlationId: commandId,
		metadata: {},
		type: "SessionCreated",
		payload: {
			sessionId: sessionTwoId,
			projectId,
			title: "Second session"
		}
	},
	{
		eventId: EventId.make("event-4"),
		aggregateKind: "project",
		aggregateId: projectId,
		occurredAt: LATER,
		commandId,
		causationEventId: null,
		correlationId: commandId,
		metadata: {},
		type: "ProjectMetaUpdated",
		payload: {
			projectId,
			title: "Acepe Desktop"
		}
	},
	{
		eventId: EventId.make("event-5"),
		aggregateKind: "session",
		aggregateId: sessionTwoId,
		occurredAt: END,
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

Vitest.layer(isolatedProjects())("one row per project", (it) => {
	it.effect("inserts a project row with repository metadata and ignores message events", () =>
		Effect.gen(function*() {
			const sql = yield* SqlClient.SqlClient
			const projects = yield* ProjectionProjects
			yield* projects.apply(
				projectEvent(1, "ProjectCreated", NOW, {
					projectId,
					title: "Acepe",
					workspaceRoot: "/tmp/acepe"
				}),
				sql
			)
			yield* projects.apply(
				sessionEvent(2, "MessageSent", LATER, {
					sessionId,
					messageId,
					text: "Ping"
				}),
				sql
			)
			const rows = yield* dumpTable()
			Vitest.assert.deepStrictEqual(rows, [
				{
					project_id: "project-1",
					title: "Acepe",
					workspace_root: "/tmp/acepe",
					created_at: NOW,
					updated_at: NOW,
					deleted_at: null,
					session_count: 0,
					scan_warmed_at: NOW
				}
			])
		})
	)
})

Vitest.layer(isolatedProjects())("pre-warmed import", (it) => {
	it.effect("lists an imported project immediately with a warmed scan", () =>
		Effect.gen(function*() {
			const sql = yield* SqlClient.SqlClient
			const projects = yield* ProjectionProjects
			yield* projects.apply(
				projectEvent(1, "ProjectCreated", NOW, {
					projectId,
					title: "Acepe",
					workspaceRoot: "/tmp/acepe"
				}),
				sql
			)
			const listed = yield* projects.list()
			const listedProject = listed[0]
			if (listedProject === undefined) {
				Vitest.assert.fail("expected a listed project")
				return
			}
			Vitest.assert.strictEqual(listed.length, 1)
			Vitest.assert.strictEqual(listedProject.scanWarmedAt, NOW)
			Vitest.assert.strictEqual(listedProject.sessionCount, 0)
			Vitest.assert.isTrue(isScanWarmed(listedProject))
		})
	)
})

Vitest.layer(isolatedProjects())("session counts on the row", (it) => {
	it.effect("stores session_count on projection_projects instead of counting at read time", () =>
		Effect.gen(function*() {
			const sql = yield* SqlClient.SqlClient
			const projects = yield* ProjectionProjects
			yield* projects.apply(
				projectEvent(1, "ProjectCreated", NOW, {
					projectId,
					title: "Acepe",
					workspaceRoot: "/tmp/acepe"
				}),
				sql
			)
			yield* projects.apply(
				sessionEvent(2, "SessionCreated", NOW, {
					sessionId,
					projectId,
					title: "First session"
				}),
				sql
			)
			yield* projects.apply(
				sessionEvent(
					3,
					"SessionCreated",
					LATER,
					{
						sessionId: sessionTwoId,
						projectId,
						title: "Second session"
					},
					sessionTwoId
				),
				sql
			)
			yield* projects.apply(
				sessionEvent(4, "SessionArchived", LATER, {
					sessionId
				}),
				sql
			)
			const before = yield* projects.list()
			Vitest.assert.strictEqual(before[0]?.sessionCount, 2)
			yield* sql`
				UPDATE projection_projects
				SET session_count = 99
				WHERE project_id = ${projectId}
			`.withoutTransform
			const listed = yield* projects.list()
			Vitest.assert.strictEqual(listed[0]?.sessionCount, 99)
			const counterTables = yield* sql<{ name: string }>`
				SELECT name
				FROM sqlite_master
				WHERE type = 'table'
					AND name = 'projection_session_counts'
			`.withoutTransform
			Vitest.assert.deepStrictEqual(counterTables, [])
		})
	)
})

Vitest.layer(isolatedProjects())("deleted projects stay in the table", (it) => {
	it.effect("sets deleted_at on the existing row", () =>
		Effect.gen(function*() {
			const sql = yield* SqlClient.SqlClient
			const projects = yield* ProjectionProjects
			yield* projects.apply(
				projectEvent(1, "ProjectCreated", NOW, {
					projectId,
					title: "Acepe",
					workspaceRoot: "/tmp/acepe"
				}),
				sql
			)
			yield* projects.apply(
				projectEvent(2, "ProjectDeleted", LATER, {
					projectId
				}),
				sql
			)
			const row = yield* projects.get(projectId)
			const project = Option.match(row, {
				onNone: () => {
					Vitest.assert.fail("expected a projected project")
					return undefined as never
				},
				onSome: (value) => value
			})
			Vitest.assert.strictEqual(project.deletedAt, LATER)
			const listed = yield* projects.list()
			Vitest.assert.strictEqual(listed.length, 1)
		})
	)
})

Vitest.layer(isolatedProjects())("truncate", (it) => {
	it.effect("clears projection_projects and membership rows", () =>
		Effect.gen(function*() {
			const sql = yield* SqlClient.SqlClient
			const projects = yield* ProjectionProjects
			yield* projects.apply(
				projectEvent(1, "ProjectCreated", NOW, {
					projectId,
					title: "Acepe",
					workspaceRoot: "/tmp/acepe"
				}),
				sql
			)
			yield* projects.apply(
				sessionEvent(2, "SessionCreated", NOW, {
					sessionId,
					projectId,
					title: "First session"
				}),
				sql
			)
			yield* projects.truncate(sql)
			const rows = yield* dumpTable()
			Vitest.assert.deepStrictEqual(rows, [])
			const membership = yield* sql<{ session_id: string }>`
				SELECT session_id FROM projection_projects_membership
			`.withoutTransform
			Vitest.assert.deepStrictEqual(membership, [])
		})
	)
})

Vitest.layer(isolatedEngine())("rebuild projection.projects", (it) => {
	it.effect("reproduces the table identically from the same event log", () =>
		Effect.gen(function*() {
			const store = yield* OrchestrationEventStore
			const projects = yield* ProjectionProjects
			const sql = yield* SqlClient.SqlClient
			yield* store.append(seedLog())
			const original = yield* withPipeline(
				[projectorOf(projects)],
				Effect.gen(function*() {
					yield* waitForSequence(projects.name, 5)
					return yield* dumpTable()
				})
			)
			Vitest.assert.deepStrictEqual(original, [
				{
					project_id: "project-1",
					title: "Acepe Desktop",
					workspace_root: "/tmp/acepe",
					created_at: NOW,
					updated_at: LATER,
					deleted_at: null,
					session_count: 1,
					scan_warmed_at: NOW
				}
			])
			yield* sql`
				UPDATE projection_projects
				SET title = 'Tampered',
					session_count = 99
				WHERE project_id = ${projectId}
			`.withoutTransform
			const rebuilt = yield* withPipeline(
				[projectorOf(projects)],
				Effect.gen(function*() {
					const pipeline = yield* ProjectionPipeline
					yield* pipeline.rebuild(projects.name)
					yield* waitForSequence(projects.name, 5)
					return yield* dumpTable()
				})
			)
			Vitest.assert.deepStrictEqual(rebuilt, original)
		})
	)
})

Vitest.layer(isolatedSnapshot())("ProjectionSnapshotQuery grades projects", (it) => {
	it.effect("returns the projected project list", () =>
		Effect.gen(function*() {
			const sql = yield* SqlClient.SqlClient
			const projects = yield* ProjectionProjects
			const query = yield* ProjectionSnapshotQuery
			yield* projects.apply(
				projectEvent(1, "ProjectCreated", NOW, {
					projectId,
					title: "Acepe",
					workspaceRoot: "/tmp/acepe"
				}),
				sql
			)
			yield* projects.apply(
				sessionEvent(2, "SessionCreated", NOW, {
					sessionId,
					projectId,
					title: "First session"
				}),
				sql
			)
			yield* checkpoint("projection.sessions", 2)
			yield* checkpoint("projection.session-messages", 2)
			yield* checkpoint("projection.turns", 2)
			yield* checkpoint("projection.session-activities", 2)
			yield* checkpoint("projection.pending-approvals", 2)
			yield* checkpoint("projection.projects", 2)
			const listed = yield* query.listProjects()
			Vitest.assert.deepStrictEqual(listed, [
				{
					projectId,
					title: "Acepe",
					workspaceRoot: "/tmp/acepe",
					createdAt: NOW,
					updatedAt: NOW,
					deletedAt: null,
					sessionCount: 1,
					scanWarmedAt: NOW
				}
			])
		})
	)
})
