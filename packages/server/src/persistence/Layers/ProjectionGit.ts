import {
	type OrchestrationEvent,
	ProjectedGitReview,
	ProjectId,
	TrimmedNonEmptyString
} from "@acepe/contracts"
import * as Arr from "effect/Array"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Option from "effect/Option"
import * as Schema from "effect/Schema"
import * as SqlClient from "effect/unstable/sql/SqlClient"
import {
	decodeStoredProjectedGitReview,
	encodeProjectedGitReview,
	evolveProjectedGitReview,
	PROJECTION_GIT_NAME,
	ProjectionGit
} from "../Services/ProjectionGit.ts"

const decodeName = Schema.decodeUnknownEffect(TrimmedNonEmptyString)

const readCurrent = Effect.fn("ProjectionGit.readCurrent")(function*(
	tx: SqlClient.SqlClient,
	projectId: ProjectId
) {
	const rows = yield* tx`
		SELECT
			project_id,
			status_json,
			files_json,
			sequence
		FROM projection_git_review
		WHERE project_id = ${projectId}
	`.withoutTransform
	return yield* Option.match(Arr.head(rows), {
		onNone: () => Effect.succeed(Option.none()),
		onSome: (row) => decodeStoredProjectedGitReview(row).pipe(Effect.map(Option.some))
	})
})

const upsert = Effect.fn("ProjectionGit.upsert")(function*(
	tx: SqlClient.SqlClient,
	review: ProjectedGitReview
) {
	const encoded = yield* encodeProjectedGitReview(review)
	yield* tx`
		INSERT INTO projection_git_review (
			project_id,
			status_json,
			files_json,
			sequence
		) VALUES (
			${encoded.projectId},
			${encoded.statusJson},
			${encoded.filesJson},
			${encoded.sequence}
		)
		ON CONFLICT(project_id) DO UPDATE SET
			status_json = excluded.status_json,
			files_json = excluded.files_json,
			sequence = excluded.sequence
	`.withoutTransform.pipe(Effect.asVoid)
})

export const ProjectionGitLive = Layer.effect(ProjectionGit)(
	Effect.gen(function*() {
		const sql = yield* SqlClient.SqlClient
		const name = yield* decodeName(PROJECTION_GIT_NAME)

		const apply = Effect.fn("ProjectionGit.apply")(function*(
			event: OrchestrationEvent,
			tx: SqlClient.SqlClient
		) {
			const current =
				event.aggregateKind === "git"
					? yield* readCurrent(tx, event.aggregateId)
					: Option.none<ProjectedGitReview>()
			const next = yield* evolveProjectedGitReview(current, event)
			if (Option.isNone(next)) {
				return
			}
			yield* upsert(tx, next.value)
		})

		const truncate = Effect.fn("ProjectionGit.truncate")(function*(tx: SqlClient.SqlClient) {
			yield* tx`DELETE FROM projection_git_review`.withoutTransform.pipe(Effect.asVoid)
		})

		const get = Effect.fn("ProjectionGit.get")(function*(projectId: ProjectId) {
			return yield* readCurrent(sql, projectId)
		})

		return ProjectionGit.of({
			name,
			apply,
			truncate,
			get
		})
	})
)
