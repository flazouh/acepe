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
import * as Layer from "effect/Layer"
import * as Option from "effect/Option"
import * as Stream from "effect/Stream"
import * as TestClock from "effect/testing/TestClock"
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
					fileCount: 1
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
			yield* client.dispatch(
				CheckpointRevertCommand.make({
					type: "checkpoint.revert",
					commandId: CommandId.make("cmd-checkpoint-revert"),
					sessionId,
					checkpointId
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
