import {
	AcepeRpc,
	CommandId,
	decodeSnapshotExit,
	MessageId,
	MessageSendCommand,
	projectSnapshotRequest,
	ProjectCreateCommand,
	ProjectId,
	SessionArchiveCommand,
	SessionCreateCommand,
	SessionDeleteCommand,
	SessionId
} from "@acepe/contracts"
import * as Vitest from "@effect/vitest"
import * as Arr from "effect/Array"
import * as Duration from "effect/Duration"
import * as Effect from "effect/Effect"
import * as Exit from "effect/Exit"
import * as Layer from "effect/Layer"
import * as Option from "effect/Option"
import * as TestClock from "effect/testing/TestClock"
import * as RpcTest from "effect/unstable/rpc/RpcTest"
import { acepeTestLive } from "../bootstrap.ts"
import { OrchestrationEngine } from "../orchestration/Services/OrchestrationEngine.ts"
import { ProjectionSnapshotQuery } from "../orchestration/Services/ProjectionSnapshotQuery.ts"
import { encodedSnapshot } from "./encodedBoundary.ts"

const isolated = () => acepeTestLive(Duration.zero).pipe(Layer.fresh)

const PROJECT_ID = ProjectId.make("snapshot-project-1")
const FALLBACK_SESSION_ID = SessionId.make("snapshot-session-fallback")
const ARTIFACT_SESSION_ID = SessionId.make("snapshot-session-artifacts")
const ARCHIVED_SESSION_ID = SessionId.make("snapshot-session-archived")
const DELETED_SESSION_ID = SessionId.make("snapshot-session-deleted")

const OTHER_PROJECT_ID = ProjectId.make("snapshot-project-2")
const OTHER_SESSION_ID = SessionId.make("snapshot-session-other")

// One project holding every session shape the snapshot must report: a plain
// session, one whose title carries an artifact mention, an archived one and a
// deleted one. A second project proves the snapshot scopes to the request.
const PROJECT_COMMANDS = [
	ProjectCreateCommand.make({
		type: "project.create",
		commandId: CommandId.make("snapshot-project"),
		projectId: PROJECT_ID,
		title: "Acepe",
		workspaceRoot: "/tmp/acepe-project-snapshot"
	}),
	SessionCreateCommand.make({
		type: "session.create",
		commandId: CommandId.make("snapshot-session-fallback"),
		sessionId: FALLBACK_SESSION_ID,
		projectId: PROJECT_ID,
		title: "New session"
	}),
	MessageSendCommand.make({
		type: "message.send",
		commandId: CommandId.make("snapshot-message-fallback"),
		sessionId: FALLBACK_SESSION_ID,
		messageId: MessageId.make("snapshot-message-fallback"),
		text: "Fix the auth bug"
	}),
	SessionCreateCommand.make({
		type: "session.create",
		commandId: CommandId.make("snapshot-session-artifacts"),
		sessionId: ARTIFACT_SESSION_ID,
		projectId: PROJECT_ID,
		title: "@[file:/src/app.ts] Ship the slice"
	}),
	SessionCreateCommand.make({
		type: "session.create",
		commandId: CommandId.make("snapshot-session-archived"),
		sessionId: ARCHIVED_SESSION_ID,
		projectId: PROJECT_ID,
		title: "Archived thread"
	}),
	SessionArchiveCommand.make({
		type: "session.archive",
		commandId: CommandId.make("snapshot-archive"),
		sessionId: ARCHIVED_SESSION_ID
	}),
	SessionCreateCommand.make({
		type: "session.create",
		commandId: CommandId.make("snapshot-session-deleted"),
		sessionId: DELETED_SESSION_ID,
		projectId: PROJECT_ID,
		title: "Deleted thread"
	}),
	SessionDeleteCommand.make({
		type: "session.delete",
		commandId: CommandId.make("snapshot-delete"),
		sessionId: DELETED_SESSION_ID
	}),
	ProjectCreateCommand.make({
		type: "project.create",
		commandId: CommandId.make("snapshot-other-project"),
		projectId: OTHER_PROJECT_ID,
		title: "Other",
		workspaceRoot: "/tmp/other"
	}),
	SessionCreateCommand.make({
		type: "session.create",
		commandId: CommandId.make("snapshot-other-session"),
		sessionId: OTHER_SESSION_ID,
		projectId: OTHER_PROJECT_ID,
		title: "Other project session"
	})
]

const dispatchProjectCommands = Effect.fn("dispatchProjectCommands")(function*() {
	const engine = yield* OrchestrationEngine
	yield* Effect.forEach(PROJECT_COMMANDS, (command) => engine.dispatch(command), {
		discard: true
	})
})

const waitForProjectSessions = Effect.fn("waitForProjectSessions")(function*() {
	const query = yield* ProjectionSnapshotQuery
	for (const _step of Arr.range(0, 199)) {
		const snapshot = yield* query.forRequest(projectSnapshotRequest(PROJECT_ID))
		const otherSnap = yield* query.forRequest(projectSnapshotRequest(OTHER_PROJECT_ID))
		const deleted = Arr.findFirst(
			snapshot.sessions,
			(row) => row.sessionId === DELETED_SESSION_ID
		)
		const archived = Arr.findFirst(
			snapshot.sessions,
			(row) => row.sessionId === ARCHIVED_SESSION_ID
		)
		const fallback = Arr.findFirst(
			snapshot.sessions,
			(row) => row.sessionId === FALLBACK_SESSION_ID
		)
		const artifacts = Arr.findFirst(
			snapshot.sessions,
			(row) => row.sessionId === ARTIFACT_SESSION_ID
		)
		const other = Arr.findFirst(
			otherSnap.sessions,
			(row) => row.sessionId === OTHER_SESSION_ID
		)
		if (
			Option.isSome(deleted) &&
			deleted.value.deletedAt !== null &&
			Option.isSome(archived) &&
			archived.value.archivedAt !== null &&
			Option.isSome(fallback) &&
			fallback.value.title === "Fix the auth bug" &&
			Option.isSome(artifacts) &&
			artifacts.value.title === "Ship the slice" &&
			Option.isSome(other)
		) {
			return snapshot
		}
		yield* TestClock.adjust(Duration.millis(1))
		yield* Effect.yieldNow
	}
	return yield* query.forRequest(projectSnapshotRequest(PROJECT_ID))
})

Vitest.layer(isolated())("project snapshot rpc", (it) => {
	it.effect("returns the selected project's sessions through snapshot, not a fourth primitive", () =>
		Effect.gen(function*() {
			yield* dispatchProjectCommands()
			yield* waitForProjectSessions()
			const client = yield* RpcTest.makeClient(AcepeRpc)
			const snapshot = yield* client.snapshot(projectSnapshotRequest(PROJECT_ID))
			Vitest.assert.strictEqual(snapshot.session, null)
			Vitest.assert.strictEqual(snapshot.projects.length, 1)
			Vitest.assert.strictEqual(snapshot.projects[0]?.projectId, PROJECT_ID)
			const byId = new Map(snapshot.sessions.map((row) => [row.sessionId, row]))
			Vitest.assert.strictEqual(byId.size, 4)
			Vitest.assert.strictEqual(byId.get(FALLBACK_SESSION_ID)?.title, "Fix the auth bug")
			Vitest.assert.strictEqual(byId.get(ARTIFACT_SESSION_ID)?.title, "Ship the slice")
			Vitest.assert.strictEqual(byId.get(ARCHIVED_SESSION_ID)?.title, "Archived thread")
			Vitest.assert.isNotNull(byId.get(ARCHIVED_SESSION_ID)?.archivedAt ?? null)
			Vitest.assert.strictEqual(byId.get(DELETED_SESSION_ID)?.title, "Deleted thread")
			Vitest.assert.isNotNull(byId.get(DELETED_SESSION_ID)?.deletedAt ?? null)
			Vitest.assert.isUndefined(byId.get(OTHER_SESSION_ID))
			const other = yield* client.snapshot(projectSnapshotRequest(OTHER_PROJECT_ID))
			Vitest.assert.strictEqual(other.sessions.length, 1)
			Vitest.assert.strictEqual(other.sessions[0]?.sessionId, OTHER_SESSION_ID)
			const encoded = yield* encodedSnapshot(projectSnapshotRequest(PROJECT_ID))
			const decoded = yield* decodeSnapshotExit(encoded)
			Vitest.assert.isTrue(Exit.isSuccess(decoded))
			if (Exit.isSuccess(decoded)) {
				Vitest.assert.strictEqual(decoded.value.sessions.length, 4)
				Vitest.assert.strictEqual(
					decoded.value.sessions.find((row) => row.sessionId === FALLBACK_SESSION_ID)?.title,
					"Fix the auth bug"
				)
			}
		})
	)
})
