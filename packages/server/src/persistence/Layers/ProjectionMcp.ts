import {
	type OrchestrationEvent,
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
	decodeStoredProjectedMcpState,
	encodeProjectedMcpState,
	evolveProjectedMcpState,
	PROJECTION_MCP_NAME,
	type ProjectedMcpState,
	ProjectionMcp
} from "../Services/ProjectionMcp.ts"

const decodeName = Schema.decodeUnknownEffect(TrimmedNonEmptyString)

const readCurrent = Effect.fn("ProjectionMcp.readCurrent")(function*(
	tx: SqlClient.SqlClient,
	projectId: ProjectId
) {
	const rows = yield* tx`
		SELECT
			project_id,
			catalog_json,
			provider_id,
			options_json,
			sequence
		FROM projection_mcp
		WHERE project_id = ${projectId}
	`.withoutTransform
	return yield* Option.match(Arr.head(rows), {
		onNone: () => Effect.succeed(Option.none()),
		onSome: (row) => decodeStoredProjectedMcpState(row).pipe(Effect.map(Option.some))
	})
})

const upsert = Effect.fn("ProjectionMcp.upsert")(function*(
	tx: SqlClient.SqlClient,
	state: ProjectedMcpState
) {
	const encoded = yield* encodeProjectedMcpState(state)
	yield* tx`
		INSERT INTO projection_mcp (
			project_id,
			catalog_json,
			provider_id,
			options_json,
			sequence
		) VALUES (
			${encoded.projectId},
			${encoded.catalogJson},
			${encoded.providerId},
			${encoded.optionsJson},
			${encoded.sequence}
		)
		ON CONFLICT(project_id) DO UPDATE SET
			catalog_json = excluded.catalog_json,
			provider_id = excluded.provider_id,
			options_json = excluded.options_json,
			sequence = excluded.sequence
	`.withoutTransform.pipe(Effect.asVoid)
})

export const ProjectionMcpLive = Layer.effect(ProjectionMcp)(
	Effect.gen(function*() {
		const sql = yield* SqlClient.SqlClient
		const name = yield* decodeName(PROJECTION_MCP_NAME)

		const apply = Effect.fn("ProjectionMcp.apply")(function*(
			event: OrchestrationEvent,
			tx: SqlClient.SqlClient
		) {
			const current =
				event.aggregateKind === "mcp"
					? yield* readCurrent(tx, event.aggregateId)
					: Option.none<ProjectedMcpState>()
			const next = yield* evolveProjectedMcpState(current, event)
			if (Option.isNone(next)) {
				return
			}
			yield* upsert(tx, next.value)
		})

		const truncate = Effect.fn("ProjectionMcp.truncate")(function*(tx: SqlClient.SqlClient) {
			yield* tx`DELETE FROM projection_mcp`.withoutTransform.pipe(Effect.asVoid)
		})

		const get = Effect.fn("ProjectionMcp.get")(function*(projectId: ProjectId) {
			return yield* readCurrent(sql, projectId)
		})

		return ProjectionMcp.of({
			name,
			apply,
			truncate,
			get
		})
	})
)
