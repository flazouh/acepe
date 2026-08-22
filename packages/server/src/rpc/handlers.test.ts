import {
	AcepeRpc,
	CommandId,
	emptySkillsCatalog,
	emptyVoiceModels,
	librarySnapshotRequest,
	ProjectCreateCommand,
	ProjectId,
	projectSnapshotRequest,
	SessionCreateCommand,
	SessionId,
	SkillsDiscoverCommand,
	VoiceModelsListCommand
} from "@acepe/contracts"
import * as BunChildProcessSpawner from "@effect/platform-bun/BunChildProcessSpawner"
import * as BunCrypto from "@effect/platform-bun/BunCrypto"
import * as BunFileSystem from "@effect/platform-bun/BunFileSystem"
import * as BunPath from "@effect/platform-bun/BunPath"
import * as Vitest from "@effect/vitest"
import * as Arr from "effect/Array"
import * as ConfigProvider from "effect/ConfigProvider"
import * as Duration from "effect/Duration"
import * as Effect from "effect/Effect"
import * as Fiber from "effect/Fiber"
import * as FileSystem from "effect/FileSystem"
import * as Layer from "effect/Layer"
import * as Option from "effect/Option"
import * as Path from "effect/Path"
import * as Stream from "effect/Stream"
import * as TestClock from "effect/testing/TestClock"
import * as SqlClient from "effect/unstable/sql/SqlClient"
import * as RpcTest from "effect/unstable/rpc/RpcTest"
import { OrchestrationCommandReceiptsLive } from "../persistence/Layers/OrchestrationCommandReceipts.ts"
import { OrchestrationEventStoreLive } from "../persistence/Layers/OrchestrationEventStore.ts"
import { makeSqliteLayer } from "../persistence/Layers/Sqlite.ts"
import { runMigrations } from "../persistence/Migrations.ts"
import {
	encodeContentJson,
	userMessageRow
} from "../persistence/Services/ProjectionSessionMessages.ts"
import { FileIndexServiceLive } from "../fileIndex/Layers/FileIndexService.ts"
import { GitServiceLive } from "../git/Layers/GitService.ts"
import { runGit } from "../git/runGit.ts"
import { OrchestrationEngineLive } from "../orchestration/Layers/OrchestrationEngine.ts"
import { ProjectionSnapshotQueryLive } from "../orchestration/Layers/ProjectionSnapshotQuery.ts"
import { SkillsServiceLive } from "../skills/Layers/SkillsService.ts"
import { VoiceRuntimeLive } from "../voice/Layers/VoiceRuntime.ts"
import { EXTERNAL_BACKEND_ID } from "../voice/Schemas.ts"
import { RpcHandlersLive } from "./handlers.ts"

const sessionId = SessionId.make("session-1")
const projectId = ProjectId.make("project-1")
const NOW = "2026-08-20T12:00:00.000Z"

const createProject = ProjectCreateCommand.make({
	type: "project.create",
	commandId: CommandId.make("cmd-1"),
	projectId,
	title: "Acepe",
	workspaceRoot: "/tmp/acepe"
})

const createSession = SessionCreateCommand.make({
	type: "session.create",
	commandId: CommandId.make("cmd-session"),
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

const EngineAndStore = OrchestrationEngineLive.pipe(
	Layer.provideMerge(PersistenceLive),
	Layer.provide(BunCrypto.layer)
)

const FileIndexPlatform = Layer.mergeAll(
	BunFileSystem.layer,
	BunPath.layer,
	BunChildProcessSpawner.layer.pipe(
		Layer.provideMerge(Layer.mergeAll(BunFileSystem.layer, BunPath.layer))
	)
)

const GitLive = Layer.unwrap(
	Effect.gen(function*() {
		const fs = yield* FileSystem.FileSystem
		const path = yield* Path.Path
		const dir = yield* fs.makeTempDirectoryScoped()
		return GitServiceLive({
			worktreesRoot: path.join(dir, "worktrees"),
			gitBin: "git",
			ghBin: "gh"
		})
	})
).pipe(Layer.provide(FileIndexPlatform), Layer.provide(BunCrypto.layer))

const SkillsLive = Layer.unwrap(
	Effect.gen(function*() {
		const fs = yield* FileSystem.FileSystem
		const dir = yield* fs.makeTempDirectoryScoped()
		return SkillsServiceLive({ homeDir: dir })
	})
).pipe(Layer.provide(FileIndexPlatform))

const VoiceLive = VoiceRuntimeLive.pipe(
	Layer.provide(FileIndexPlatform),
	Layer.provide(ConfigProvider.layer(ConfigProvider.fromEnv({ env: {} })))
)

const TestLive = RpcHandlersLive.pipe(
	Layer.provideMerge(ProjectionSnapshotQueryLive),
	Layer.provideMerge(EngineAndStore),
	Layer.provideMerge(FileIndexServiceLive),
	Layer.provideMerge(GitLive),
	Layer.provideMerge(SkillsLive),
	Layer.provideMerge(VoiceLive),
	Layer.provideMerge(FileIndexPlatform)
)

const isolatedRpc = () => Layer.fresh(TestLive)

const insertSession = Effect.fn("insertSession")(function*() {
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
			${sessionId},
			${projectId},
			${"Ship the slice"},
			NULL,
			${NOW},
			${NOW},
			${NOW},
			NULL,
			NULL
		)
	`.withoutTransform.pipe(Effect.asVoid)
})

const insertLibraryRows = Effect.fn("insertLibraryRows")(function*() {
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
			${2},
			${NOW}
		)
	`.withoutTransform.pipe(Effect.asVoid)
	yield* insertSession()
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
			${SessionId.make("session-archived")},
			${projectId},
			${"Archived thread"},
			NULL,
			${NOW},
			${NOW},
			${NOW},
			${NOW},
			NULL
		)
	`.withoutTransform.pipe(Effect.asVoid)
})

const noneEnv = Option.none<Readonly<Record<string, string>>>()
const noAllow = Arr.empty<number>()

const gitIn = Effect.fn("gitIn")(function*(dir: string, args: ReadonlyArray<string>) {
	yield* runGit({
		gitBin: "git",
		args: Arr.fromIterable(args),
		cwd: dir,
		allowExitCodes: noAllow,
		env: noneEnv
	})
})

const insertProjectAt = Effect.fn("insertProjectAt")(function*(workspaceRoot: string) {
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
			${workspaceRoot},
			${NOW},
			${NOW},
			NULL,
			${0},
			${NOW}
		)
	`.withoutTransform.pipe(Effect.asVoid)
})

const initDirtyRepo = Effect.fn("initDirtyRepo")(function*(dir: string) {
	const fs = yield* FileSystem.FileSystem
	const path = yield* Path.Path
	yield* gitIn(dir, Arr.fromIterable(["init"]))
	yield* gitIn(dir, Arr.fromIterable(["config", "user.name", "Test User"]))
	yield* gitIn(dir, Arr.fromIterable(["config", "user.email", "test@example.com"]))
	yield* gitIn(dir, Arr.fromIterable(["config", "commit.gpgsign", "false"]))
	yield* fs.writeFileString(path.join(dir, "tracked.txt"), "one\n")
	yield* gitIn(dir, Arr.fromIterable(["add", "tracked.txt"]))
	yield* gitIn(dir, Arr.fromIterable(["commit", "-m", "initial tracked file"]))
	yield* fs.writeFileString(path.join(dir, "tracked.txt"), "one\ntwo\n")
})

const insertUserMessage = Effect.fn("insertUserMessage")(function*() {
	const sql = yield* SqlClient.SqlClient
	const row = userMessageRow({
		sessionId,
		sequence: 2,
		messageId: "message-2",
		turnId: null,
		text: "Ship the slice"
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

Vitest.layer(isolatedRpc())("accepted dispatch", (it) => {
	it.effect("returns the committed sequence", () =>
		Effect.gen(function*() {
			const client = yield* RpcTest.makeClient(AcepeRpc)
			const result = yield* client.dispatch(createProject)
			Vitest.assert.strictEqual(result.sequence, 1)
		})
	)
})

Vitest.layer(isolatedRpc())("invariant failure", (it) => {
	it.effect("preserves OrchestrationCommandInvariantError tag", () =>
		Effect.gen(function*() {
			const client = yield* RpcTest.makeClient(AcepeRpc)
			const error = yield* Effect.flip(client.dispatch(createSession))
			Vitest.assert.strictEqual(error._tag, "OrchestrationCommandInvariantError")
		})
	)
})

Vitest.layer(isolatedRpc())("previously rejected command", (it) => {
	it.effect("preserves OrchestrationCommandPreviouslyRejectedError tag", () =>
		Effect.gen(function*() {
			const client = yield* RpcTest.makeClient(AcepeRpc)
			yield* Effect.flip(client.dispatch(createSession))
			const error = yield* Effect.flip(client.dispatch(createSession))
			Vitest.assert.strictEqual(error._tag, "OrchestrationCommandPreviouslyRejectedError")
		})
	)
})

Vitest.layer(isolatedRpc())("empty snapshot", (it) => {
	it.effect("returns an empty projection when the session is missing", () =>
		Effect.gen(function*() {
			const client = yield* RpcTest.makeClient(AcepeRpc)
			const snapshot = yield* client.snapshot({ sessionId })
			Vitest.assert.strictEqual(snapshot.snapshotSequence, 0)
			Vitest.assert.strictEqual(snapshot.session, null)
			Vitest.assert.deepStrictEqual(snapshot.messages, [])
			Vitest.assert.deepStrictEqual(snapshot.turns, [])
			Vitest.assert.deepStrictEqual(snapshot.activities, [])
			Vitest.assert.deepStrictEqual(snapshot.pendingApprovals, [])
			Vitest.assert.deepStrictEqual(snapshot.checkpoints, [])
			Vitest.assert.deepStrictEqual(snapshot.projects, [])
			Vitest.assert.deepStrictEqual(snapshot.sessions, [])
		})
	)
})

Vitest.layer(isolatedRpc())("library snapshot", (it) => {
	it.effect("returns projects and sessions from the projection", () =>
		Effect.gen(function*() {
			const client = yield* RpcTest.makeClient(AcepeRpc)
			yield* insertLibraryRows()
			const snapshot = yield* client.snapshot(librarySnapshotRequest())
			Vitest.assert.strictEqual(snapshot.session, null)
			Vitest.assert.strictEqual(snapshot.projects[0]?.title, "Acepe")
			Vitest.assert.strictEqual(snapshot.sessions.length, 2)
			const archived = snapshot.sessions.find((row) => row.title === "Archived thread")
			Vitest.assert.strictEqual(archived?.archivedAt, NOW)
			Vitest.assert.strictEqual(archived?.deletedAt, null)
		})
	)
})

Vitest.layer(isolatedRpc())("projected snapshot", (it) => {
	it.effect("maps a stored session and user message onto the contract snapshot", () =>
		Effect.gen(function*() {
			const client = yield* RpcTest.makeClient(AcepeRpc)
			yield* insertSession()
			yield* insertUserMessage()
			yield* checkpoint("projection.sessions", 4)
			yield* checkpoint("projection.session-messages", 4)
			yield* checkpoint("projection.turns", 4)
			yield* checkpoint("projection.session-activities", 4)
			yield* checkpoint("projection.pending-approvals", 4)
			const snapshot = yield* client.snapshot({ sessionId })
			Vitest.assert.strictEqual(snapshot.snapshotSequence, 4)
			Vitest.assert.strictEqual(snapshot.session?.sessionId, sessionId)
			const message = snapshot.messages[0]
			Vitest.assert.strictEqual(message?.rowType, "user")
			if (message?.rowType === "user") {
				Vitest.assert.strictEqual(message.content.text, "Ship the slice")
			}
		})
	)
})

Vitest.layer(isolatedRpc())("skills discover", (it) => {
	it.effect("fills the catalog from disk before dispatch", () =>
		Effect.gen(function*() {
			const client = yield* RpcTest.makeClient(AcepeRpc)
			yield* client.dispatch(
				SkillsDiscoverCommand.make({
					type: "skills.discover",
					commandId: CommandId.make("cmd-skills"),
					catalog: emptySkillsCatalog
				})
			)
			const events = yield* Stream.take(client.events({ fromSequence: 0 }), 1).pipe(
				Stream.runCollect
			)
			Vitest.assert.strictEqual(events[0]?.type, "SkillsDiscovered")
			if (events[0]?.type === "SkillsDiscovered") {
				Vitest.assert.strictEqual(events[0].payload.agents.length, 4)
			}
		})
	)
})

Vitest.layer(isolatedRpc())("voice models list", (it) => {
	it.effect("fills models from the voice service before dispatch", () =>
		Effect.gen(function*() {
			const client = yield* RpcTest.makeClient(AcepeRpc)
			yield* client.dispatch(
				VoiceModelsListCommand.make({
					type: "voice.models.list",
					commandId: CommandId.make("cmd-voice"),
					models: emptyVoiceModels
				})
			)
			const events = yield* Stream.take(client.events({ fromSequence: 0 }), 1).pipe(
				Stream.runCollect
			)
			Vitest.assert.strictEqual(events[0]?.type, "VoiceModelsListed")
			if (events[0]?.type === "VoiceModelsListed") {
				Vitest.assert.strictEqual(events[0].payload.models[0]?.id, EXTERNAL_BACKEND_ID)
			}
		})
	)
})

Vitest.layer(isolatedRpc())("event replay", (it) => {
	it.effect("replays committed events after the requested sequence", () =>
		Effect.gen(function*() {
			const client = yield* RpcTest.makeClient(AcepeRpc)
			yield* client.dispatch(createProject)
			const events = yield* Stream.take(client.events({ fromSequence: 0 }), 1).pipe(
				Stream.runCollect
			)
			Vitest.assert.strictEqual(events[0]?.type, "ProjectCreated")
			Vitest.assert.strictEqual(events[0]?.sequence, 1)
		})
	)
})

Vitest.layer(isolatedRpc())("live events", (it) => {
	it.effect("emits live events after subscribe", () =>
		Effect.gen(function*() {
			const client = yield* RpcTest.makeClient(AcepeRpc)
			const fiber = yield* Stream.take(client.events({ fromSequence: 0 }), 1).pipe(
				Stream.runCollect,
				Effect.forkScoped
			)
			yield* TestClock.adjust(Duration.millis(50))
			yield* client.dispatch(createProject)
			const events = yield* Fiber.join(fiber)
			Vitest.assert.strictEqual(events[0]?.type, "ProjectCreated")
			Vitest.assert.strictEqual(events[0]?.sequence, 1)
		})
	)
})

Vitest.layer(isolatedRpc())("file index rpc", (it) => {
	it.effect("returns a project index over getProjectIndex", () =>
		Effect.gen(function*() {
			const fs = yield* FileSystem.FileSystem
			const path = yield* Path.Path
			const client = yield* RpcTest.makeClient(AcepeRpc)
			const dir = yield* fs.makeTempDirectoryScoped()
			yield* fs.writeFileString(path.join(dir, "main.ts"), "export const main = 1\n")
			const index = yield* client.getProjectIndex({ projectPath: dir })
			Vitest.assert.strictEqual(index.projectPath, dir)
			Vitest.assert.strictEqual(Arr.some(index.files, (file) => file.path === "main.ts"), true)
		})
	)

	it.effect("fails getProjectIndex when the root is missing", () =>
		Effect.gen(function*() {
			const client = yield* RpcTest.makeClient(AcepeRpc)
			const error = yield* Effect.flip(
				client.getProjectIndex({ projectPath: "/missing/acepe-file-index-rpc" })
			)
			Vitest.assert.strictEqual(error._tag, "FileIndexRootNotFoundError")
		})
	)
})

Vitest.layer(isolatedRpc())("project snapshot git status", (it) => {
	it.effect("returns live git status for a project-scoped snapshot request", () =>
		Effect.gen(function*() {
			const fs = yield* FileSystem.FileSystem
			const client = yield* RpcTest.makeClient(AcepeRpc)
			const dir = yield* fs.makeTempDirectoryScoped()
			yield* initDirtyRepo(dir)
			yield* insertProjectAt(dir)
			const snapshot = yield* client.snapshot(projectSnapshotRequest(projectId))
			const project = snapshot.projects[0]
			Vitest.assert.isDefined(project)
			// null would mean git failed; this test asserts git ran and saw the change.
			Vitest.assert.isNotNull(project.gitStatus)
			const rows = project.gitStatus ?? Arr.empty()
			const tracked = Arr.findFirst(rows, (row) => row.path === "tracked.txt")
			Vitest.assert.strictEqual(Option.isSome(tracked), true)
			if (Option.isSome(tracked)) {
				Vitest.assert.strictEqual(tracked.value.status, "M")
				Vitest.assert.strictEqual(tracked.value.insertions, 1)
				Vitest.assert.strictEqual(tracked.value.deletions, 0)
			}
		})
	)
})

Vitest.layer(isolatedRpc())("library snapshot git status", (it) => {
	it.effect("returns an empty git status list for a library snapshot", () =>
		Effect.gen(function*() {
			const fs = yield* FileSystem.FileSystem
			const client = yield* RpcTest.makeClient(AcepeRpc)
			const dir = yield* fs.makeTempDirectoryScoped()
			yield* initDirtyRepo(dir)
			yield* insertProjectAt(dir)
			const snapshot = yield* client.snapshot(librarySnapshotRequest())
			// A library snapshot does not run git per project, so status is
			// "not read" (null), not "read and clean" ([]).
			Vitest.assert.strictEqual(snapshot.projects[0]?.gitStatus, null)
		})
	)
})

Vitest.layer(isolatedRpc())("missing workspace git status", (it) => {
	it.effect("keeps the project when the workspace path is missing", () =>
		Effect.gen(function*() {
			const client = yield* RpcTest.makeClient(AcepeRpc)
			yield* insertProjectAt("/missing/acepe-git-status-workspace")
			const snapshot = yield* client.snapshot(projectSnapshotRequest(projectId))
			Vitest.assert.strictEqual(
				snapshot.projects[0]?.workspaceRoot,
				"/missing/acepe-git-status-workspace"
			)
			// The workspace does not exist, so git could not run. That is null,
			// not an empty list: the review panel must not read this as "clean".
			Vitest.assert.strictEqual(snapshot.projects[0]?.gitStatus, null)
		})
	)
})
