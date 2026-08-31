import {
	encodeStoredSessionConfigOptionValues,
	encodeStoredSessionModelCatalog,
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

const sqliteFlag = (value: boolean): 0 | 1 => (value ? 1 : 0)

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
			pr_link_mode,
			provider_session_id,
			provider_session_failed,
			ephemeral,
			current_mode_id,
			current_model_id,
			available_models,
			config_options
		FROM projection_sessions
		WHERE session_id = ${sessionId}
	`.withoutTransform
	return yield* Option.match(Arr.head(rows), {
		onNone: () => Effect.succeed(Option.none()),
		onSome: (row) => decodeStoredProjectedSession(row).pipe(Effect.map(Option.some))
	})
})

const readByProviderSessionId = Effect.fn("ProjectionSessions.readByProviderSessionId")(
	function*(tx: SqlClient.SqlClient, providerSessionId: TrimmedNonEmptyString) {
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
				pr_link_mode,
				provider_session_id,
				provider_session_failed,
				ephemeral,
				current_mode_id,
				current_model_id,
				available_models,
				config_options
			FROM projection_sessions
			WHERE provider_session_id = ${providerSessionId}
				AND deleted_at IS NULL
			ORDER BY session_id ASC
		`.withoutTransform
		return yield* Option.match(Arr.head(rows), {
			onNone: () => Effect.succeed(Option.none()),
			onSome: (row) => decodeStoredProjectedSession(row).pipe(Effect.map(Option.some))
		})
	}
)

const readCurrent = Effect.fn("ProjectionSessions.readCurrent")(function*(
	tx: SqlClient.SqlClient,
	event: OrchestrationEvent
) {
	if (event.aggregateKind !== "session") {
		return Option.none()
	}
	return yield* readById(tx, event.aggregateId)
})

const upsert = Effect.fn("ProjectionSessions.upsert")(function*(
	tx: SqlClient.SqlClient,
	session: ProjectedSession
) {
	// JSON text through the schema that reads it back, not JSON.stringify --
	// the same encoder ProjectionSessionActivities uses for its payloads.
	const storedModels = yield* encodeStoredSessionModelCatalog(session.availableModels ?? null)
	const storedConfigOptions = yield* encodeStoredSessionConfigOptionValues(
		session.configOptions ?? null
	)
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
			pr_link_mode,
			provider_session_id,
			provider_session_failed,
			ephemeral,
			current_mode_id,
			current_model_id,
			available_models,
			config_options
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
			${session.prLinkMode},
			${session.providerSessionId},
			${sqliteFlag(session.providerSessionFailed)},
			${sqliteFlag(session.ephemeral)},
			${session.currentModeId ?? null},
			${session.currentModelId ?? null},
			${storedModels},
			${storedConfigOptions}
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
			pr_link_mode = excluded.pr_link_mode,
			provider_session_id = excluded.provider_session_id,
			provider_session_failed = excluded.provider_session_failed,
			ephemeral = excluded.ephemeral,
			current_mode_id = excluded.current_mode_id,
			current_model_id = excluded.current_model_id,
			available_models = excluded.available_models,
			config_options = excluded.config_options
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
							pr_link_mode,
							provider_session_id,
							provider_session_failed,
							ephemeral,
							current_mode_id,
							current_model_id,
							available_models,
							config_options
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
							pr_link_mode,
							provider_session_id,
							provider_session_failed,
							ephemeral,
							current_mode_id,
							current_model_id,
							available_models,
							config_options
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

		const findByProviderSessionId = Effect.fn("ProjectionSessions.findByProviderSessionId")(
			function*(providerSessionId: TrimmedNonEmptyString) {
				return yield* readByProviderSessionId(sql, providerSessionId)
			}
		)

		return ProjectionSessions.of({
			name,
			apply,
			truncate,
			list,
			listForProject,
			get,
			findByProviderSessionId
		})
	})
)
