import {
	type OrchestrationEvent,
	ProjectId,
	SessionId,
	TrimmedNonEmptyString
} from "@acepe/contracts"
import * as Arr from "effect/Array"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Option from "effect/Option"
import * as Schema from "effect/Schema"
import * as SqlClient from "effect/unstable/sql/SqlClient"
import {
	decodeStoredProjectedSession,
	evolveProjectedSession,
	type ProjectedSession,
	ProjectionSessions
} from "../Services/ProjectionSessions.ts"

const decodeName = Schema.decodeUnknownEffect(TrimmedNonEmptyString)

const readById = Effect.fn("ProjectionSessions.readById")(function*(
	tx: SqlClient.SqlClient,
	sessionId: SessionId
) {
	const rows = yield* tx`
		SELECT
			session_id,
			project_id,
			title,
			provider,
			created_at,
			updated_at,
			last_activity_at,
			archived_at,
			deleted_at,
			pr_number,
			pr_link_mode
		FROM projection_sessions
		WHERE session_id = ${sessionId}
	`.withoutTransform
	return yield* Option.match(Arr.head(rows), {
		onNone: () => Effect.succeed(Option.none()),
		onSome: (row) => decodeStoredProjectedSession(row).pipe(Effect.map(Option.some))
	})
})

const readCurrent = Effect.fn("ProjectionSessions.readCurrent")(function*(
	tx: SqlClient.SqlClient,
	event: OrchestrationEvent
) {
	if (event.aggregateKind === "project") {
		return Option.none()
	}
	return yield* readById(tx, event.aggregateId)
})

const upsert = Effect.fn("ProjectionSessions.upsert")(function*(
	tx: SqlClient.SqlClient,
	session: ProjectedSession
) {
	yield* tx`
		INSERT INTO projection_sessions (
			session_id,
			project_id,
			title,
			provider,
			created_at,
			updated_at,
			last_activity_at,
			archived_at,
			deleted_at,
			pr_number,
			pr_link_mode
		) VALUES (
			${session.sessionId},
			${session.projectId},
			${session.title},
			${session.provider},
			${session.createdAt},
			${session.updatedAt},
			${session.lastActivityAt},
			${session.archivedAt},
			${session.deletedAt},
			${session.prNumber},
			${session.prLinkMode}
		)
		ON CONFLICT(session_id) DO UPDATE SET
			project_id = excluded.project_id,
			title = excluded.title,
			provider = excluded.provider,
			created_at = excluded.created_at,
			updated_at = excluded.updated_at,
			last_activity_at = excluded.last_activity_at,
			archived_at = excluded.archived_at,
			deleted_at = excluded.deleted_at,
			pr_number = excluded.pr_number,
			pr_link_mode = excluded.pr_link_mode
	`.withoutTransform.pipe(Effect.asVoid)
})

export const ProjectionSessionsLive = Layer.effect(ProjectionSessions)(
	Effect.gen(function*() {
		const sql = yield* SqlClient.SqlClient
		const name = yield* decodeName("projection.sessions")

		const apply = Effect.fn("ProjectionSessions.apply")(function*(
			event: OrchestrationEvent,
			tx: SqlClient.SqlClient
		) {
			const current = yield* readCurrent(tx, event)
			const next = yield* evolveProjectedSession(current, event)
			if (Option.isNone(next)) {
				return
			}
			yield* upsert(tx, next.value)
		})

		const truncate = Effect.fn("ProjectionSessions.truncate")(function*(tx: SqlClient.SqlClient) {
			yield* tx`DELETE FROM projection_sessions`.withoutTransform.pipe(Effect.asVoid)
		})

		const readListed = Effect.fn("ProjectionSessions.readListed")(function*(
			projectId: ProjectId | null
		) {
			const rows =
				projectId === null
					? yield* sql`
						SELECT
							session_id,
							project_id,
							title,
							provider,
							created_at,
							updated_at,
							last_activity_at,
							archived_at,
							deleted_at,
							pr_number,
							pr_link_mode
						FROM projection_sessions
						ORDER BY last_activity_at DESC, session_id ASC
					`.withoutTransform
					: yield* sql`
						SELECT
							session_id,
							project_id,
							title,
							provider,
							created_at,
							updated_at,
							last_activity_at,
							archived_at,
							deleted_at,
							pr_number,
							pr_link_mode
						FROM projection_sessions
						WHERE project_id = ${projectId}
						ORDER BY last_activity_at DESC, session_id ASC
					`.withoutTransform
			return yield* Effect.forEach(rows, decodeStoredProjectedSession)
		})

		const list = Effect.fn("ProjectionSessions.list")(function*() {
			return yield* readListed(null)
		})

		const listForProject = Effect.fn("ProjectionSessions.listForProject")(function*(
			projectId: ProjectId
		) {
			return yield* readListed(projectId)
		})

		const get = Effect.fn("ProjectionSessions.get")(function*(sessionId: SessionId) {
			return yield* readById(sql, sessionId)
		})

		return ProjectionSessions.of({
			name,
			apply,
			truncate,
			list,
			listForProject,
			get
		})
	})
)
