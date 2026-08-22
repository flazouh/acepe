import {
	AcepeRpc,
	CommandId,
	decodeSnapshotExit,
	projectSnapshotRequest,
	ProjectCreateCommand,
	ProjectId,
	SessionCreateCommand,
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
import {
	LIBRARY_SEED_ARCHIVED_SESSION_ID,
	LIBRARY_SEED_ARTIFACT_SESSION_ID,
	LIBRARY_SEED_DELETED_SESSION_ID,
	LIBRARY_SEED_FALLBACK_SESSION_ID,
	LIBRARY_SEED_PROJECT_ID,
	seedLibrary
} from "../library/seedLibrary.ts"
import { OrchestrationEngine } from "../orchestration/Services/OrchestrationEngine.ts"
import { ProjectionSnapshotQuery } from "../orchestration/Services/ProjectionSnapshotQuery.ts"
import { encodedSnapshot } from "./encodedBoundary.ts"

const isolated = () => acepeTestLive(Duration.zero).pipe(Layer.fresh)

const OTHER_PROJECT_ID = ProjectId.make("library-project-2")
const OTHER_SESSION_ID = SessionId.make("library-session-other")

const seedOtherProject = Effect.fn("seedOtherProject")(function*() {
	const engine = yield* OrchestrationEngine
	yield* engine.dispatch(
		ProjectCreateCommand.make({
			type: "project.create",
			commandId: CommandId.make("seed-other-project"),
			projectId: OTHER_PROJECT_ID,
			title: "Other",
			workspaceRoot: "/tmp/other"
		})
	)
	yield* engine.dispatch(
		SessionCreateCommand.make({
			type: "session.create",
			commandId: CommandId.make("seed-other-session"),
			sessionId: OTHER_SESSION_ID,
			projectId: OTHER_PROJECT_ID,
			title: "Other project session"
		})
	)
})

const waitForSeededProjectSessions = Effect.fn("waitForSeededProjectSessions")(function*() {
	const query = yield* ProjectionSnapshotQuery
	for (const _step of Arr.range(0, 199)) {
		const snapshot = yield* query.forRequest(projectSnapshotRequest(LIBRARY_SEED_PROJECT_ID))
		const otherSnap = yield* query.forRequest(projectSnapshotRequest(OTHER_PROJECT_ID))
		const deleted = Arr.findFirst(
			snapshot.sessions,
			(row) => row.sessionId === LIBRARY_SEED_DELETED_SESSION_ID
		)
		const archived = Arr.findFirst(
			snapshot.sessions,
			(row) => row.sessionId === LIBRARY_SEED_ARCHIVED_SESSION_ID
		)
		const fallback = Arr.findFirst(
			snapshot.sessions,
			(row) => row.sessionId === LIBRARY_SEED_FALLBACK_SESSION_ID
		)
		const artifacts = Arr.findFirst(
			snapshot.sessions,
			(row) => row.sessionId === LIBRARY_SEED_ARTIFACT_SESSION_ID
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
	return yield* query.forRequest(projectSnapshotRequest(LIBRARY_SEED_PROJECT_ID))
})

Vitest.layer(isolated())("project snapshot rpc", (it) => {
	it.effect("returns the selected project's sessions through snapshot, not a fourth primitive", () =>
		Effect.gen(function*() {
			yield* seedLibrary()
			yield* seedOtherProject()
			yield* waitForSeededProjectSessions()
			const client = yield* RpcTest.makeClient(AcepeRpc)
			const snapshot = yield* client.snapshot(projectSnapshotRequest(LIBRARY_SEED_PROJECT_ID))
			Vitest.assert.strictEqual(snapshot.session, null)
			Vitest.assert.strictEqual(snapshot.projects.length, 1)
			Vitest.assert.strictEqual(snapshot.projects[0]?.projectId, LIBRARY_SEED_PROJECT_ID)
			const byId = new Map(snapshot.sessions.map((row) => [row.sessionId, row]))
			Vitest.assert.strictEqual(byId.size, 4)
			Vitest.assert.strictEqual(byId.get(LIBRARY_SEED_FALLBACK_SESSION_ID)?.title, "Fix the auth bug")
			Vitest.assert.strictEqual(byId.get(LIBRARY_SEED_ARTIFACT_SESSION_ID)?.title, "Ship the slice")
			Vitest.assert.strictEqual(byId.get(LIBRARY_SEED_ARCHIVED_SESSION_ID)?.title, "Archived thread")
			Vitest.assert.isNotNull(byId.get(LIBRARY_SEED_ARCHIVED_SESSION_ID)?.archivedAt ?? null)
			Vitest.assert.strictEqual(byId.get(LIBRARY_SEED_DELETED_SESSION_ID)?.title, "Deleted thread")
			Vitest.assert.isNotNull(byId.get(LIBRARY_SEED_DELETED_SESSION_ID)?.deletedAt ?? null)
			Vitest.assert.isUndefined(byId.get(OTHER_SESSION_ID))
			const other = yield* client.snapshot(projectSnapshotRequest(OTHER_PROJECT_ID))
			Vitest.assert.strictEqual(other.sessions.length, 1)
			Vitest.assert.strictEqual(other.sessions[0]?.sessionId, OTHER_SESSION_ID)
			const encoded = yield* encodedSnapshot(projectSnapshotRequest(LIBRARY_SEED_PROJECT_ID))
			const decoded = yield* decodeSnapshotExit(encoded)
			Vitest.assert.isTrue(Exit.isSuccess(decoded))
			if (Exit.isSuccess(decoded)) {
				Vitest.assert.strictEqual(decoded.value.sessions.length, 4)
				Vitest.assert.strictEqual(
					decoded.value.sessions.find(
						(row) => row.sessionId === LIBRARY_SEED_FALLBACK_SESSION_ID
					)?.title,
					"Fix the auth bug"
				)
			}
		})
	)
})
