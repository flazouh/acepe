import {
	ActivityId,
	ApprovalRequestId,
	librarySnapshotRequest,
	ProjectId,
	projectSnapshotRequest,
	SessionId,
	settingsSnapshotRequest,
	TurnId
} from "@acepe/contracts"
import * as BunFileSystem from "@effect/platform-bun/BunFileSystem"
import * as BunPath from "@effect/platform-bun/BunPath"
import * as Vitest from "@effect/vitest"
import * as Deferred from "effect/Deferred"
import * as Effect from "effect/Effect"
import * as Fiber from "effect/Fiber"
import * as FileSystem from "effect/FileSystem"
import * as Layer from "effect/Layer"
import * as Path from "effect/Path"
import * as SqlClient from "effect/unstable/sql/SqlClient"
import { makeSqliteLayer } from "../../persistence/Layers/Sqlite.ts"
import { runMigrations } from "../../persistence/Migrations.ts"
import {
	encodeContentJson,
	userMessageRow
} from "../../persistence/Services/ProjectionSessionMessages.ts"
import { ProjectionSnapshotQuery } from "../Services/ProjectionSnapshotQuery.ts"
import { ProjectionSnapshotQueryLive } from "./ProjectionSnapshotQuery.ts"

const NOW = "2026-08-20T12:00:00.000Z"
const LATER = "2026-08-20T12:00:01.000Z"
const sessionId = SessionId.make("session-1")
const otherSessionId = SessionId.make("session-2")
const archivedSessionId = SessionId.make("session-archived")
const deletedSessionId = SessionId.make("session-deleted")
const projectId = ProjectId.make("project-1")

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

const TestLive = ProjectionSnapshotQueryLive.pipe(Layer.provideMerge(MigratedSqlite))

const isolatedQuery = () => Layer.fresh(TestLive)

const insertSession = Effect.fn("insertSession")(function*(
	id: SessionId,
	title: string,
	archivedAt: string | null = null,
	deletedAt: string | null = null
) {
	const sql = yield* SqlClient.SqlClient
	yield* sql`
		INSERT INTO projection_sessions (
			session_id,
			project_id,
			title,
			provider,
			created_at,
			updated_at,
			last_activity_at,
			archived_at,
			deleted_at
		) VALUES (
			${id},
			${projectId},
			${title},
			NULL,
			${NOW},
			${NOW},
			${NOW},
			${archivedAt},
			${deletedAt}
		)
	`.withoutTransform.pipe(Effect.asVoid)
})

const insertProject = Effect.fn("insertProject")(function*() {
	const sql = yield* SqlClient.SqlClient
	yield* sql`
		INSERT INTO projection_projects (
			project_id,
			title,
			workspace_root,
			created_at,
			updated_at,
			deleted_at,
			session_count,
			scan_warmed_at
		) VALUES (
			${projectId},
			${"Acepe"},
			${"/tmp/acepe"},
			${NOW},
			${NOW},
			NULL,
			${3},
			${NOW}
		)
	`.withoutTransform.pipe(Effect.asVoid)
})

const insertSetting = Effect.fn("insertSetting")(function*(
	key: string,
	value: string,
	sequence: number
) {
	const sql = yield* SqlClient.SqlClient
	yield* sql`
		INSERT INTO projection_settings (
			setting_key,
			setting_value,
			sequence
		) VALUES (
			${key},
			${value},
			${sequence}
		)
	`.withoutTransform.pipe(Effect.asVoid)
})

const insertMessage = Effect.fn("insertMessage")(function*(
	id: SessionId,
	sequence: number,
	text: string
) {
	const sql = yield* SqlClient.SqlClient
	const row = userMessageRow({
		sessionId: id,
		sequence,
		messageId: `message-${sequence}`,
		turnId: null,
		text
	})
	const content = yield* encodeContentJson(row)
	yield* sql`
		INSERT INTO projection_session_messages (
			session_id,
			sequence,
			message_id,
			turn_id,
			row_type,
			content
		) VALUES (
			${row.sessionId},
			${row.sequence},
			${row.messageId},
			${row.turnId},
			${row.rowType},
			${content}
		)
	`.withoutTransform.pipe(Effect.asVoid)
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

const createOptionalTables = Effect.gen(function*() {
	const sql = yield* SqlClient.SqlClient
	yield* sql`
		CREATE TABLE IF NOT EXISTS projection_turns (
			turn_id TEXT PRIMARY KEY NOT NULL,
			session_id TEXT NOT NULL,
			sequence INTEGER NOT NULL
		)
	`.withoutTransform
	yield* sql`
		CREATE TABLE IF NOT EXISTS projection_session_activities (
			activity_id TEXT PRIMARY KEY NOT NULL,
			session_id TEXT NOT NULL,
			sequence INTEGER NOT NULL
		)
	`.withoutTransform
	yield* sql`
		CREATE TABLE IF NOT EXISTS projection_pending_approvals (
			approval_request_id TEXT PRIMARY KEY NOT NULL,
			session_id TEXT NOT NULL,
			sequence INTEGER NOT NULL
		)
	`.withoutTransform
})

Vitest.layer(isolatedQuery())("missing session", (it) => {
	it.effect("returns a null session, empty collections, and snapshotSequence 0", () =>
		Effect.gen(function*() {
			const query = yield* ProjectionSnapshotQuery
			const snapshot = yield* query.snapshot(sessionId)
			Vitest.assert.deepStrictEqual(snapshot, {
				snapshotSequence: 0,
				session: null,
				messages: [],
				turns: [],
				activities: [],
				pendingApprovals: [],
				checkpoints: [],
				projects: [],
				sessions: [],
				settings: []
			})
		})
	)
})

Vitest.layer(isolatedQuery())("listProjects", (it) => {
	it.effect("returns an empty list when projection_projects has no rows", () =>
		Effect.gen(function*() {
			const query = yield* ProjectionSnapshotQuery
			const listed = yield* query.listProjects()
			Vitest.assert.deepStrictEqual(listed, [])
		})
	)
})

Vitest.layer(isolatedQuery())("library snapshot", (it) => {
	it.effect("returns projects and sessions including archived and deleted", () =>
		Effect.gen(function*() {
			const query = yield* ProjectionSnapshotQuery
			yield* insertProject()
			yield* insertSession(sessionId, "Ship the slice")
			yield* insertSession(archivedSessionId, "Archived thread", LATER, null)
			yield* insertSession(deletedSessionId, "Deleted thread", null, LATER)
			yield* checkpoint("projection.sessions", 6)
			yield* checkpoint("projection.projects", 6)
			const snapshot = yield* query.forRequest(librarySnapshotRequest())
			Vitest.assert.strictEqual(snapshot.session, null)
			Vitest.assert.strictEqual(snapshot.projects.length, 1)
			Vitest.assert.strictEqual(snapshot.projects[0]?.title, "Acepe")
			Vitest.assert.strictEqual(snapshot.sessions.length, 3)
			const titles = snapshot.sessions.map((row) => row.title)
			Vitest.assert.isTrue(titles.includes("Ship the slice"))
			Vitest.assert.isTrue(titles.includes("Archived thread"))
			Vitest.assert.isTrue(titles.includes("Deleted thread"))
			const archived = snapshot.sessions.find((row) => row.sessionId === archivedSessionId)
			const deleted = snapshot.sessions.find((row) => row.sessionId === deletedSessionId)
			Vitest.assert.strictEqual(archived?.archivedAt, LATER)
			Vitest.assert.strictEqual(deleted?.deletedAt, LATER)
			const projectSnap = yield* query.forRequest(projectSnapshotRequest(projectId))
			Vitest.assert.strictEqual(projectSnap.projects[0]?.projectId, projectId)
			Vitest.assert.strictEqual(projectSnap.sessions.length, 3)
		})
	)
})

Vitest.layer(isolatedQuery())("settings snapshot", (it) => {
	it.effect("returns projected settings through the settings snapshot request", () =>
		Effect.gen(function*() {
			const query = yield* ProjectionSnapshotQuery
			yield* insertSetting("ui_font_size", "14", 1)
			yield* insertSetting("code_font_size", "13", 2)
			yield* checkpoint("projection.settings", 2)
			const snapshot = yield* query.forRequest(settingsSnapshotRequest())
			Vitest.assert.strictEqual(snapshot.session, null)
			Vitest.assert.deepStrictEqual(snapshot.settings, [
				{ key: "code_font_size", value: "13", sequence: 2 },
				{ key: "ui_font_size", value: "14", sequence: 1 }
			])
		})
	)
})

Vitest.layer(isolatedQuery())("one transaction snapshot", (it) => {
	it.effect("returns session, messages, turns, activities and pending approvals", () =>
		Effect.gen(function*() {
			const sql = yield* SqlClient.SqlClient
			const query = yield* ProjectionSnapshotQuery
			yield* insertSession(sessionId, "Ship the slice")
			yield* insertMessage(sessionId, 2, "Ship the slice")
			yield* insertMessage(otherSessionId, 2, "Other session")
			yield* checkpoint("projection.sessions", 5)
			yield* checkpoint("projection.session-messages", 5)
			yield* checkpoint("projection.turns", 5)
			yield* checkpoint("projection.session-activities", 5)
			yield* checkpoint("projection.pending-approvals", 5)
			yield* createOptionalTables
			yield* sql`
				INSERT INTO projection_turns (turn_id, session_id, sequence)
				VALUES ('turn-1', ${sessionId}, 3)
			`.withoutTransform
			yield* sql`
				INSERT INTO projection_session_activities (activity_id, session_id, sequence)
				VALUES ('activity-1', ${sessionId}, 4)
			`.withoutTransform
			yield* sql`
				INSERT INTO projection_pending_approvals (approval_request_id, session_id, sequence)
				VALUES ('approval-1', ${sessionId}, 5)
			`.withoutTransform
			const snapshot = yield* query.snapshot(sessionId)
			Vitest.assert.strictEqual(snapshot.snapshotSequence, 5)
			Vitest.assert.strictEqual(snapshot.session?.sessionId, sessionId)
			Vitest.assert.strictEqual(snapshot.session?.title, "Ship the slice")
			Vitest.assert.strictEqual(snapshot.messages.length, 1)
			const message = snapshot.messages[0]
			Vitest.assert.isDefined(message)
			Vitest.assert.strictEqual(message.rowType, "user")
			if (message.rowType !== "user") {
				return
			}
			Vitest.assert.strictEqual(message.content.text, "Ship the slice")
			Vitest.assert.deepStrictEqual(snapshot.turns, [
				{
					turnId: TurnId.make("turn-1"),
					sessionId,
					sequence: 3
				}
			])
			Vitest.assert.deepStrictEqual(snapshot.activities, [
				{
					activityId: ActivityId.make("activity-1"),
					sessionId,
					sequence: 4
				}
			])
			Vitest.assert.deepStrictEqual(snapshot.pendingApprovals, [
				{
					approvalRequestId: ApprovalRequestId.make("approval-1"),
					sessionId,
					sequence: 5
				}
			])
		})
	)
})

Vitest.layer(isolatedQuery())("snapshotSequence", (it) => {
	it.effect("is the minimum last-applied sequence across snapshot projectors", () =>
		Effect.gen(function*() {
			const query = yield* ProjectionSnapshotQuery
			yield* insertSession(sessionId, "Ship the slice")
			yield* insertMessage(sessionId, 2, "Ship the slice")
			yield* checkpoint("projection.sessions", 10)
			yield* checkpoint("projection.session-messages", 8)
			const snapshot = yield* query.snapshot(sessionId)
			Vitest.assert.strictEqual(snapshot.snapshotSequence, 8)
		})
	)
})

Vitest.layer(isolatedQuery())("sequence filter", (it) => {
	it.effect("hides collection rows above snapshotSequence", () =>
		Effect.gen(function*() {
			const query = yield* ProjectionSnapshotQuery
			yield* insertSession(sessionId, "Ship the slice")
			yield* insertMessage(sessionId, 2, "included")
			yield* insertMessage(sessionId, 4, "too new")
			yield* checkpoint("projection.sessions", 5)
			yield* checkpoint("projection.session-messages", 3)
			const snapshot = yield* query.snapshot(sessionId)
			Vitest.assert.strictEqual(snapshot.snapshotSequence, 3)
			Vitest.assert.deepStrictEqual(
				snapshot.messages.map((row) => row.sequence),
				[2]
			)
		})
	)
})

Vitest.layer(isolatedQuery())("no N+1 across messages", (it) => {
	it.effect("returns every in-sequence message for the session in one snapshot", () =>
		Effect.gen(function*() {
			const query = yield* ProjectionSnapshotQuery
			yield* insertSession(sessionId, "Ship the slice")
			yield* insertMessage(sessionId, 5, "fifth")
			yield* insertMessage(sessionId, 2, "second")
			yield* insertMessage(sessionId, 3, "third")
			yield* insertMessage(sessionId, 4, "fourth")
			yield* insertMessage(otherSessionId, 2, "other")
			yield* checkpoint("projection.sessions", 5)
			yield* checkpoint("projection.session-messages", 5)
			const snapshot = yield* query.snapshot(sessionId)
			Vitest.assert.deepStrictEqual(
				snapshot.messages.map((row) => row.sequence),
				[2, 3, 4, 5]
			)
			Vitest.assert.deepStrictEqual(
				snapshot.messages.map((row) => {
					if (row.rowType !== "user") {
						return row.rowType
					}
					return row.content.text
				}),
				["second", "third", "fourth", "fifth"]
			)
		})
	)
})

Vitest.layer(isolatedQuery())("optional tables absent", (it) => {
	it.effect("returns empty turns, activities, pending approvals and checkpoints", () =>
		Effect.gen(function*() {
			const query = yield* ProjectionSnapshotQuery
			yield* insertSession(sessionId, "Ship the slice")
			yield* checkpoint("projection.sessions", 1)
			const snapshot = yield* query.snapshot(sessionId)
			Vitest.assert.deepStrictEqual(snapshot.turns, [])
			Vitest.assert.deepStrictEqual(snapshot.activities, [])
			Vitest.assert.deepStrictEqual(snapshot.pendingApprovals, [])
			Vitest.assert.deepStrictEqual(snapshot.checkpoints, [])
			Vitest.assert.deepStrictEqual(snapshot.settings, [])
		})
	)
})

Vitest.layer(isolatedQuery())("mid-apply isolation", (it) => {
	it.effect("never shows a half-applied event", () =>
		Effect.gen(function*() {
			const sql = yield* SqlClient.SqlClient
			const query = yield* ProjectionSnapshotQuery
			yield* insertSession(sessionId, "before")
			yield* checkpoint("projection.sessions", 1)
			yield* checkpoint("projection.session-messages", 1)
			const started = yield* Deferred.make<void>()
			const release = yield* Deferred.make<void>()
			const writer = yield* Effect.forkChild(
				sql.withTransaction(
					Effect.gen(function*() {
						yield* insertMessage(sessionId, 2, "after")
						yield* Deferred.succeed(started, undefined)
						yield* Deferred.await(release)
						yield* sql`
							UPDATE projection_sessions
							SET title = 'after',
								updated_at = ${LATER},
								last_activity_at = ${LATER}
							WHERE session_id = ${sessionId}
						`.withoutTransform
						yield* checkpoint("projection.sessions", 2)
						yield* checkpoint("projection.session-messages", 2)
					})
				)
			)
			yield* Deferred.await(started)
			const snapFiber = yield* Effect.forkChild(query.snapshot(sessionId))
			yield* Effect.yieldNow
			yield* Deferred.succeed(release, undefined)
			const snapshot = yield* Fiber.join(snapFiber)
			yield* Fiber.join(writer)
			const title = snapshot.session === null ? null : snapshot.session.title
			const hasNewMessage = snapshot.messages.length === 1
			Vitest.assert.strictEqual(hasNewMessage, title === "after")
			Vitest.assert.strictEqual(title, "after")
			Vitest.assert.strictEqual(snapshot.snapshotSequence, 2)
			const message = snapshot.messages[0]
			Vitest.assert.isDefined(message)
			Vitest.assert.strictEqual(message.rowType, "user")
			if (message.rowType !== "user") {
				return
			}
			Vitest.assert.strictEqual(message.content.text, "after")
		})
	)
})
