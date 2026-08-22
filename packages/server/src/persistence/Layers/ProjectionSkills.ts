import {
	APP_SKILLS_ID,
	type OrchestrationEvent,
	ProjectedSkillsCatalog,
	TrimmedNonEmptyString
} from "@acepe/contracts"
import * as Arr from "effect/Array"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Option from "effect/Option"
import * as Schema from "effect/Schema"
import * as SqlClient from "effect/unstable/sql/SqlClient"
import {
	decodeStoredProjectedSkillsCatalog,
	encodeProjectedSkillsCatalog,
	evolveProjectedSkillsCatalog,
	PROJECTION_SKILLS_NAME,
	ProjectionSkills
} from "../Services/ProjectionSkills.ts"

const decodeName = Schema.decodeUnknownEffect(TrimmedNonEmptyString)

const readCurrent = Effect.fn("ProjectionSkills.readCurrent")(function*(tx: SqlClient.SqlClient) {
	const rows = yield* tx`
		SELECT
			catalog_id,
			agents_json,
			agent_skills_json,
			plugins_json,
			plugin_skills_json,
			tree_json,
			sequence
		FROM projection_skills_catalog
		WHERE catalog_id = ${APP_SKILLS_ID}
	`.withoutTransform
	return yield* Option.match(Arr.head(rows), {
		onNone: () => Effect.succeed(Option.none()),
		onSome: (row) => decodeStoredProjectedSkillsCatalog(row).pipe(Effect.map(Option.some))
	})
})

const upsert = Effect.fn("ProjectionSkills.upsert")(function*(
	tx: SqlClient.SqlClient,
	catalog: ProjectedSkillsCatalog
) {
	const encoded = yield* encodeProjectedSkillsCatalog(catalog)
	yield* tx`
		INSERT INTO projection_skills_catalog (
			catalog_id,
			agents_json,
			agent_skills_json,
			plugins_json,
			plugin_skills_json,
			tree_json,
			sequence
		) VALUES (
			${encoded.catalogId},
			${encoded.agentsJson},
			${encoded.agentSkillsJson},
			${encoded.pluginsJson},
			${encoded.pluginSkillsJson},
			${encoded.treeJson},
			${encoded.sequence}
		)
		ON CONFLICT(catalog_id) DO UPDATE SET
			agents_json = excluded.agents_json,
			agent_skills_json = excluded.agent_skills_json,
			plugins_json = excluded.plugins_json,
			plugin_skills_json = excluded.plugin_skills_json,
			tree_json = excluded.tree_json,
			sequence = excluded.sequence
	`.withoutTransform.pipe(Effect.asVoid)
})

export const ProjectionSkillsLive = Layer.effect(ProjectionSkills)(
	Effect.gen(function*() {
		const sql = yield* SqlClient.SqlClient
		const name = yield* decodeName(PROJECTION_SKILLS_NAME)

		const apply = Effect.fn("ProjectionSkills.apply")(function*(
			event: OrchestrationEvent,
			tx: SqlClient.SqlClient
		) {
			const current = yield* readCurrent(tx)
			const next = yield* evolveProjectedSkillsCatalog(current, event)
			if (Option.isNone(next)) {
				return
			}
			yield* upsert(tx, next.value)
		})

		const truncate = Effect.fn("ProjectionSkills.truncate")(function*(tx: SqlClient.SqlClient) {
			yield* tx`DELETE FROM projection_skills_catalog`.withoutTransform.pipe(Effect.asVoid)
		})

		const get = Effect.fn("ProjectionSkills.get")(function*() {
			return yield* readCurrent(sql)
		})

		return ProjectionSkills.of({
			name,
			apply,
			truncate,
			get
		})
	})
)
