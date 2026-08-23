import {
	AcepeRpc,
	CheckpointCreateCommand,
	CheckpointId,
	CheckpointReportReadinessCommand,
	CheckpointRevertCommand,
	CommandId,
	ProjectCreateCommand,
	ProjectId,
	type RpcServerError,
	type RpcSessionSnapshot,
	SessionCreateCommand,
	SessionId,
	sessionSnapshotRequest
} from "@acepe/contracts"
import * as Vitest from "@effect/vitest"
import * as Arr from "effect/Array"
import * as Duration from "effect/Duration"
import * as Effect from "effect/Effect"
import * as FileSystem from "effect/FileSystem"
import * as Layer from "effect/Layer"
import * as Option from "effect/Option"
import * as Path from "effect/Path"
import * as Stream from "effect/Stream"
import * as TestClock from "effect/testing/TestClock"
import * as SqlClient from "effect/unstable/sql/SqlClient"
import * as RpcTest from "effect/unstable/rpc/RpcTest"
import { acepeTestLive } from "../bootstrap.ts"

const isolated = () => acepeTestLive(Duration.zero).pipe(Layer.fresh)

const projectId = ProjectId.make("project-1")
const sessionId = SessionId.make("session-1")
const checkpointId = CheckpointId.make("checkpoint-1")

const waitForCheckpoint = Effect.fn("waitForCheckpoint")(function*(
	readSnapshot: () => Effect.Effect<RpcSessionSnapshot, RpcServerError>,
	expected: {
		readonly status: "ready" | "missing" | "error"
		readonly lastRevertedAtPresent: boolean
	}
) {
	for (const _step of Arr.range(0, 199)) {
		const snapshot = yield* readSnapshot()
		const found = Arr.findFirst(
			snapshot.checkpoints,
			(row) => row.checkpointId === checkpointId
		)
		if (
			Option.isSome(found) &&
			found.value.status === expected.status &&
			(found.value.lastRevertedAt !== null) === expected.lastRevertedAtPresent
		) {
			return snapshot
		}
		yield* TestClock.adjust(Duration.millis(1))
		yield* Effect.yieldNow
	}
	return yield* readSnapshot()
})

Vitest.layer(isolated())("checkpoint create and revert through snapshot", (it) => {
	it.effect("exposes create and revert only through dispatch, snapshot, and events", () =>
		Effect.gen(function*() {
			const client = yield* RpcTest.makeClient(AcepeRpc)
			const readSnapshot = () => client.snapshot(sessionSnapshotRequest(sessionId))
			yield* client.dispatch(
				ProjectCreateCommand.make({
					type: "project.create",
					commandId: CommandId.make("cmd-project"),
					projectId,
					title: "Acepe",
					workspaceRoot: "/tmp/acepe"
				})
			)
			yield* client.dispatch(
				SessionCreateCommand.make({
					type: "session.create",
					commandId: CommandId.make("cmd-session"),
					sessionId,
					projectId,
					title: "First session"
				})
			)
			yield* client.dispatch(
				CheckpointCreateCommand.make({
					type: "checkpoint.create",
					commandId: CommandId.make("cmd-checkpoint-create"),
					sessionId,
					checkpointId,
					checkpointNumber: 1,
					name: "After edit",
					isAuto: false,
					toolCallId: null,
					fileCount: 1,
					projectPath: null,
					worktreePath: null,
					modifiedFiles: []
				})
			)
			yield* client.dispatch(
				CheckpointReportReadinessCommand.make({
					type: "checkpoint.report-readiness",
					commandId: CommandId.make("cmd-checkpoint-ready"),
					sessionId,
					checkpointId,
					status: "ready"
				})
			)
			const afterCreate = yield* waitForCheckpoint(readSnapshot, {
				status: "ready",
				lastRevertedAtPresent: false
			})
			Vitest.assert.strictEqual(afterCreate.checkpoints.length, 1)
			Vitest.assert.strictEqual(afterCreate.checkpoints[0]?.checkpointId, checkpointId)
			Vitest.assert.strictEqual(afterCreate.checkpoints[0]?.status, "ready")
			Vitest.assert.strictEqual(afterCreate.checkpoints[0]?.lastRevertedAt, null)
			Vitest.assert.strictEqual(afterCreate.checkpoints[0]?.name, "After edit")
			Vitest.assert.deepStrictEqual(afterCreate.checkpoints[0]?.files, [])
			yield* client.dispatch(
				CheckpointRevertCommand.make({
					type: "checkpoint.revert",
					commandId: CommandId.make("cmd-checkpoint-revert"),
					sessionId,
					checkpointId,
					projectPath: null,
					worktreePath: null
				})
			)
			const afterRevert = yield* waitForCheckpoint(readSnapshot, {
				status: "ready",
				lastRevertedAtPresent: true
			})
			Vitest.assert.strictEqual(afterRevert.checkpoints.length, 1)
			Vitest.assert.strictEqual(afterRevert.checkpoints[0]?.status, "ready")
			Vitest.assert.notStrictEqual(afterRevert.checkpoints[0]?.lastRevertedAt, null)
			const events = yield* Stream.take(client.events({ fromSequence: 0 }), 5).pipe(
				Stream.runCollect
			)
			Vitest.assert.deepStrictEqual(
				Arr.map(events, (event) => event.type),
				[
					"ProjectCreated",
					"SessionCreated",
					"CheckpointCreated",
					"CheckpointReadinessChanged",
					"CheckpointReverted"
				]
			)
		})
	)
})

const ioProjectId = ProjectId.make("project-io")
const ioSessionId = SessionId.make("session-io")
const ioCheckpointId = CheckpointId.make("checkpoint-io")
const ORIGINAL = "hello world"
const CHANGED = "changed"

const waitForIoCheckpoint = Effect.fn("waitForIoCheckpoint")(function*(
	readSnapshot: () => Effect.Effect<RpcSessionSnapshot, RpcServerError>,
	expected: {
		readonly status: "ready" | "missing" | "error"
		readonly lastRevertedAtPresent: boolean
		readonly hasFileContent: boolean
	}
) {
	for (const _step of Arr.range(0, 199)) {
		const snapshot = yield* readSnapshot()
		const found = Arr.findFirst(
			snapshot.checkpoints,
			(row) => row.checkpointId === ioCheckpointId
		)
		if (
			Option.isSome(found) &&
			found.value.status === expected.status &&
			(found.value.lastRevertedAt !== null) === expected.lastRevertedAtPresent &&
			(found.value.files[0]?.content !== undefined) === expected.hasFileContent
		) {
			return snapshot
		}
		yield* TestClock.adjust(Duration.millis(1))
		yield* Effect.yieldNow
	}
	return yield* readSnapshot()
})

Vitest.layer(isolated())("checkpoint file IO through snapshot", (it) => {
	it.effect("persists files, joins them on snapshot, and keeps status off the blob table", () =>
		Effect.gen(function*() {
			const client = yield* RpcTest.makeClient(AcepeRpc)
			const fs = yield* FileSystem.FileSystem
			const path = yield* Path.Path
			const sql = yield* SqlClient.SqlClient
			const dir = yield* fs.makeTempDirectoryScoped()
			yield* fs.writeFileString(path.join(dir, "hello.ts"), ORIGINAL)
			const readSnapshot = () => client.snapshot(sessionSnapshotRequest(ioSessionId))
			yield* client.dispatch(
				ProjectCreateCommand.make({
					type: "project.create",
					commandId: CommandId.make("cmd-project-io"),
					projectId: ioProjectId,
					title: "Acepe",
					workspaceRoot: dir
				})
			)
			yield* client.dispatch(
				SessionCreateCommand.make({
					type: "session.create",
					commandId: CommandId.make("cmd-session-io"),
					sessionId: ioSessionId,
					projectId: ioProjectId,
					title: "IO session"
				})
			)
			yield* client.dispatch(
				CheckpointCreateCommand.make({
					type: "checkpoint.create",
					commandId: CommandId.make("cmd-checkpoint-io-create"),
					sessionId: ioSessionId,
					checkpointId: ioCheckpointId,
					checkpointNumber: 1,
					name: "After edit",
					isAuto: false,
					toolCallId: null,
					fileCount: 1,
					projectPath: dir,
					worktreePath: null,
					modifiedFiles: ["hello.ts"]
				})
			)
			yield* client.dispatch(
				CheckpointReportReadinessCommand.make({
					type: "checkpoint.report-readiness",
					commandId: CommandId.make("cmd-checkpoint-io-ready"),
					sessionId: ioSessionId,
					checkpointId: ioCheckpointId,
					status: "ready"
				})
			)
			const afterCreate = yield* waitForIoCheckpoint(readSnapshot, {
				status: "ready",
				lastRevertedAtPresent: false,
				hasFileContent: true
			})
			Vitest.assert.strictEqual(afterCreate.checkpoints.length, 1)
			Vitest.assert.strictEqual(afterCreate.checkpoints[0]?.files[0]?.path, "hello.ts")
			Vitest.assert.strictEqual(afterCreate.checkpoints[0]?.files[0]?.content, ORIGINAL)
			const blobColumns = yield* sql<{ name: string }>`
				PRAGMA table_info(checkpoints)
			`.withoutTransform
			Vitest.assert.isFalse(blobColumns.some((column) => column.name === "status"))
			const projected = yield* sql<{ status: string }>`
				SELECT status FROM projection_checkpoints WHERE checkpoint_id = ${ioCheckpointId}
			`.withoutTransform
			Vitest.assert.strictEqual(projected[0]?.status, "ready")
			yield* fs.writeFileString(path.join(dir, "hello.ts"), CHANGED)
			yield* client.dispatch(
				CheckpointRevertCommand.make({
					type: "checkpoint.revert",
					commandId: CommandId.make("cmd-checkpoint-io-revert"),
					sessionId: ioSessionId,
					checkpointId: ioCheckpointId,
					projectPath: dir,
					worktreePath: null
				})
			)
			const afterRevert = yield* waitForIoCheckpoint(readSnapshot, {
				status: "ready",
				lastRevertedAtPresent: true,
				hasFileContent: true
			})
			Vitest.assert.notStrictEqual(afterRevert.checkpoints[0]?.lastRevertedAt, null)
			Vitest.assert.strictEqual(yield* fs.readFileString(path.join(dir, "hello.ts")), ORIGINAL)
		})
	)
})
