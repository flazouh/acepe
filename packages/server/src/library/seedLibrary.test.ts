import { librarySnapshotRequest } from "@acepe/contracts"
import * as Duration from "effect/Duration"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Option from "effect/Option"
import * as Arr from "effect/Array"
import * as TestClock from "effect/testing/TestClock"
import * as Vitest from "@effect/vitest"
import { acepeTestLive } from "../bootstrap.ts"
import { ProjectionSnapshotQuery } from "../orchestration/Services/ProjectionSnapshotQuery.ts"
import {
	LIBRARY_SEED_ARCHIVED_SESSION_ID,
	LIBRARY_SEED_ARTIFACT_SESSION_ID,
	LIBRARY_SEED_DELETED_SESSION_ID,
	LIBRARY_SEED_FALLBACK_SESSION_ID,
	LIBRARY_SEED_PROJECT_ID,
	seedLibrary
} from "./seedLibrary.ts"

const isolated = () => acepeTestLive(Duration.zero).pipe(Layer.fresh)

const waitForSeededLibrary = Effect.fn("waitForSeededLibrary")(function*() {
	const query = yield* ProjectionSnapshotQuery
	for (const _step of Arr.range(0, 199)) {
		const snapshot = yield* query.forRequest(librarySnapshotRequest())
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
		if (
			Option.isSome(deleted) &&
			deleted.value.deletedAt !== null &&
			Option.isSome(archived) &&
			archived.value.archivedAt !== null &&
			Option.isSome(fallback) &&
			fallback.value.title === "Fix the auth bug" &&
			Option.isSome(artifacts) &&
			artifacts.value.title === "Ship the slice"
		) {
			return snapshot
		}
		yield* TestClock.adjust(Duration.millis(1))
		yield* Effect.yieldNow
	}
	return yield* query.forRequest(librarySnapshotRequest())
})

Vitest.layer(isolated())("seedLibrary", (it) => {
	it.effect("projects real titles including fallback, artifact strip, archived and deleted", () =>
		Effect.gen(function*() {
			yield* seedLibrary()
			const snapshot = yield* waitForSeededLibrary()
			Vitest.assert.strictEqual(snapshot.projects[0]?.projectId, LIBRARY_SEED_PROJECT_ID)
			Vitest.assert.strictEqual(snapshot.projects[0]?.title, "Acepe")
			const byId = new Map(snapshot.sessions.map((row) => [row.sessionId, row]))
			Vitest.assert.strictEqual(
				byId.get(LIBRARY_SEED_FALLBACK_SESSION_ID)?.title,
				"Fix the auth bug"
			)
			Vitest.assert.strictEqual(
				byId.get(LIBRARY_SEED_ARTIFACT_SESSION_ID)?.title,
				"Ship the slice"
			)
			Vitest.assert.strictEqual(
				byId.get(LIBRARY_SEED_ARCHIVED_SESSION_ID)?.title,
				"Archived thread"
			)
			Vitest.assert.isNotNull(byId.get(LIBRARY_SEED_ARCHIVED_SESSION_ID)?.archivedAt ?? null)
			Vitest.assert.strictEqual(
				byId.get(LIBRARY_SEED_DELETED_SESSION_ID)?.title,
				"Deleted thread"
			)
			Vitest.assert.isNotNull(byId.get(LIBRARY_SEED_DELETED_SESSION_ID)?.deletedAt ?? null)
			yield* seedLibrary()
			const again = yield* waitForSeededLibrary()
			Vitest.assert.strictEqual(again.sessions.length, snapshot.sessions.length)
		})
	)
})
