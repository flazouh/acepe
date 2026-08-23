import { gitSnapshotRequest, parseUnifiedHunks } from "@acepe/contracts"
import * as Duration from "effect/Duration"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Arr from "effect/Array"
import * as TestClock from "effect/testing/TestClock"
import * as Vitest from "@effect/vitest"
import { acepeTestLive } from "../bootstrap.ts"
import { ProjectionSnapshotQuery } from "../orchestration/Services/ProjectionSnapshotQuery.ts"
import {
	GIT_REVIEW_SEED_FILE,
	GIT_REVIEW_SEED_PROJECT_ID,
	seedGitReview
} from "./seedGitReview.ts"

const isolated = () => acepeTestLive(Duration.zero).pipe(Layer.fresh)

const waitForSeededGitReview = Effect.fn("waitForSeededGitReview")(function*() {
	const query = yield* ProjectionSnapshotQuery
	for (const _step of Arr.range(0, 199)) {
		const snapshot = yield* query.forRequest(gitSnapshotRequest(GIT_REVIEW_SEED_PROJECT_ID))
		if (
			snapshot.gitReview !== null &&
			snapshot.gitReview.projectId === GIT_REVIEW_SEED_PROJECT_ID &&
			snapshot.gitReview.status !== null &&
			snapshot.gitReview.files[0]?.diff !== null &&
			(snapshot.gitReview.files[0]?.blame.length ?? 0) > 0
		) {
			return snapshot
		}
		yield* TestClock.adjust(Duration.millis(1))
		yield* Effect.yieldNow
	}
	return yield* query.forRequest(gitSnapshotRequest(GIT_REVIEW_SEED_PROJECT_ID))
})

Vitest.layer(isolated())("seedGitReview", (it) => {
	it.effect("creates the git review project and projects status", () =>
		Effect.gen(function*() {
			yield* seedGitReview()
			const snapshot = yield* waitForSeededGitReview()
			Vitest.assert.strictEqual(snapshot.projects[0]?.projectId, GIT_REVIEW_SEED_PROJECT_ID)
			Vitest.assert.strictEqual(snapshot.projects[0]?.title, "Git review")
			Vitest.assert.isNotNull(snapshot.gitReview?.status)
			Vitest.assert.strictEqual(snapshot.gitReview?.status?.[0]?.path, GIT_REVIEW_SEED_FILE)
			Vitest.assert.strictEqual(snapshot.gitReview?.files[0]?.path, GIT_REVIEW_SEED_FILE)
			Vitest.assert.isNotNull(snapshot.gitReview?.files[0]?.diff)
			Vitest.assert.strictEqual(parseUnifiedHunks(snapshot.gitReview?.files[0]?.patch ?? "").length, 2)
			Vitest.assert.isAbove(snapshot.gitReview?.files[0]?.blame.length ?? 0, 0)
		})
	)
})
