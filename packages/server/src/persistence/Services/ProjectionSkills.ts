import {
	AgentSkills,
	APP_SKILLS_ID,
	type OrchestrationEvent,
	PluginInfo,
	PluginSkill,
	ProjectedSkillsCatalog,
	Sequence,
	SkillAgent,
	SkillsDiscoveredPayload,
	SkillTreeNode,
	TrimmedNonEmptyString
} from "@acepe/contracts"
import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as Match from "effect/Match"
import * as Option from "effect/Option"
import * as Schema from "effect/Schema"
import type * as SqlClient from "effect/unstable/sql/SqlClient"
import type { SqlError } from "effect/unstable/sql/SqlError"

export const PROJECTION_SKILLS_NAME = "projection.skills"
export const PROJECTION_SKILLS_TABLE = "projection_skills_catalog"

export type { ProjectedSkillsCatalog }

export const ProjectionSkillsCatalogRow = Schema.Struct({
	catalog_id: Schema.String,
	agents_json: Schema.String,
	agent_skills_json: Schema.String,
	plugins_json: Schema.String,
	plugin_skills_json: Schema.String,
	tree_json: Schema.String,
	sequence: Sequence
})
export type ProjectionSkillsCatalogRow = typeof ProjectionSkillsCatalogRow.Type

export interface ProjectionSkillsShape {
	readonly name: TrimmedNonEmptyString
	readonly apply: (
		event: OrchestrationEvent,
		tx: SqlClient.SqlClient
	) => Effect.Effect<void, SqlError | Schema.SchemaError>
	readonly truncate: (
		tx: SqlClient.SqlClient
	) => Effect.Effect<void, SqlError | Schema.SchemaError>
	readonly get: () => Effect.Effect<
		Option.Option<ProjectedSkillsCatalog>,
		SqlError | Schema.SchemaError
	>
}

export class ProjectionSkills extends Context.Service<ProjectionSkills, ProjectionSkillsShape>()(
	"@acepe/server/persistence/Services/ProjectionSkills"
) {}

const decodeRow = Schema.decodeUnknownEffect(ProjectionSkillsCatalogRow)
const decodeAgents = Schema.decodeUnknownEffect(Schema.fromJsonString(Schema.Array(SkillAgent)))
const decodeAgentSkills = Schema.decodeUnknownEffect(
	Schema.fromJsonString(Schema.Array(AgentSkills))
)
const decodePlugins = Schema.decodeUnknownEffect(Schema.fromJsonString(Schema.Array(PluginInfo)))
const decodePluginSkills = Schema.decodeUnknownEffect(
	Schema.fromJsonString(Schema.Array(PluginSkill))
)
const decodeTree = Schema.decodeUnknownEffect(Schema.fromJsonString(Schema.Array(SkillTreeNode)))
const encodeAgents = Schema.encodeEffect(Schema.fromJsonString(Schema.Array(SkillAgent)))
const encodeAgentSkills = Schema.encodeEffect(Schema.fromJsonString(Schema.Array(AgentSkills)))
const encodePlugins = Schema.encodeEffect(Schema.fromJsonString(Schema.Array(PluginInfo)))
const encodePluginSkills = Schema.encodeEffect(Schema.fromJsonString(Schema.Array(PluginSkill)))
const encodeTree = Schema.encodeEffect(Schema.fromJsonString(Schema.Array(SkillTreeNode)))

export const encodeProjectedSkillsCatalog = Effect.fn("encodeProjectedSkillsCatalog")(function*(
	catalog: ProjectedSkillsCatalog
) {
	const agentsJson = yield* encodeAgents(catalog.agents)
	const agentSkillsJson = yield* encodeAgentSkills(catalog.agentSkills)
	const pluginsJson = yield* encodePlugins(catalog.plugins)
	const pluginSkillsJson = yield* encodePluginSkills(catalog.pluginSkills)
	const treeJson = yield* encodeTree(catalog.tree)
	return {
		catalogId: APP_SKILLS_ID,
		agentsJson,
		agentSkillsJson,
		pluginsJson,
		pluginSkillsJson,
		treeJson,
		sequence: catalog.sequence
	}
})

export const decodeStoredProjectedSkillsCatalog = Effect.fn("decodeStoredProjectedSkillsCatalog")(
	function*(input: unknown) {
		const row = yield* decodeRow(input)
		const agents = yield* decodeAgents(row.agents_json)
		const agentSkills = yield* decodeAgentSkills(row.agent_skills_json)
		const plugins = yield* decodePlugins(row.plugins_json)
		const pluginSkills = yield* decodePluginSkills(row.plugin_skills_json)
		const tree = yield* decodeTree(row.tree_json)
		return {
			sequence: row.sequence,
			agents,
			agentSkills,
			plugins,
			pluginSkills,
			tree
		} satisfies ProjectedSkillsCatalog
	}
)

const ignoreEvent = (
	current: Option.Option<ProjectedSkillsCatalog>
): Effect.Effect<Option.Option<ProjectedSkillsCatalog>> => Effect.succeed(current)

const projectSkillsDiscovered = (
	event: Extract<OrchestrationEvent, { readonly type: "SkillsDiscovered" }>
): Effect.Effect<Option.Option<ProjectedSkillsCatalog>, Schema.SchemaError> =>
	Schema.decodeUnknownEffect(SkillsDiscoveredPayload)(event.payload).pipe(
		Effect.map((payload) =>
			Option.some({
				sequence: event.sequence,
				agents: payload.agents,
				agentSkills: payload.agentSkills,
				plugins: payload.plugins,
				pluginSkills: payload.pluginSkills,
				tree: payload.tree
			})
		)
	)

export const evolveProjectedSkillsCatalog = (
	current: Option.Option<ProjectedSkillsCatalog>,
	event: OrchestrationEvent
): Effect.Effect<Option.Option<ProjectedSkillsCatalog>, Schema.SchemaError> =>
	Match.type<OrchestrationEvent>().pipe(
		Match.discriminatorsExhaustive("type")({
			ProjectCreated: () => ignoreEvent(current),
			ProjectMetaUpdated: () => ignoreEvent(current),
			ProjectDeleted: () => ignoreEvent(current),
			SessionCreated: () => ignoreEvent(current),
			SessionMetaUpdated: () => ignoreEvent(current),
			SessionArchived: () => ignoreEvent(current),
			SessionUnarchived: () => ignoreEvent(current),
			SessionDeleted: () => ignoreEvent(current),
			MessageSent: () => ignoreEvent(current),
			TokenAppended: () => ignoreEvent(current),
			TurnCancelled: () => ignoreEvent(current),
			CheckpointCreated: () => ignoreEvent(current),
			CheckpointReadinessChanged: () => ignoreEvent(current),
			CheckpointReverted: () => ignoreEvent(current),
			SettingsUpdated: () => ignoreEvent(current),
			SkillsDiscovered: (discovered) => projectSkillsDiscovered(discovered),
			VoiceModelsListed: () => ignoreEvent(current),
			VoiceLanguagesListed: () => ignoreEvent(current),
			VoiceModelStatusReported: () => ignoreEvent(current),
			VoiceModelDownloaded: () => ignoreEvent(current),
			VoiceModelDeleted: () => ignoreEvent(current),
			VoiceModelLoaded: () => ignoreEvent(current),
			VoiceRecordingStarted: () => ignoreEvent(current),
			VoiceRecordingStopped: () => ignoreEvent(current),
			VoiceRecordingCancelled: () => ignoreEvent(current)
		})
	)(event)
