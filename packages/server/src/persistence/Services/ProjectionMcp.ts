import {
	ComposerMcpCatalog,
	ConfigOptionData,
	emptyProjectedMcpCatalog,
	emptyProjectedPreconnectionOptions,
	McpCatalogResolvedPayload,
	type OrchestrationEvent,
	PreconnectionOptionsLoadedPayload,
	ProjectedMcpCatalog,
	ProjectedPreconnectionOptions,
	ProjectId,
	Sequence,
	TrimmedNonEmptyString
} from "@acepe/contracts"
import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as Match from "effect/Match"
import * as Option from "effect/Option"
import * as Schema from "effect/Schema"
import type * as SqlClient from "effect/unstable/sql/SqlClient"
import type { SqlError } from "effect/unstable/sql/SqlError"

export const PROJECTION_MCP_NAME = "projection.mcp"
export const PROJECTION_MCP_TABLE = "projection_mcp"

export type ProjectedMcpState = {
	readonly mcpCatalog: ProjectedMcpCatalog
	readonly preconnectionOptions: ProjectedPreconnectionOptions
}

export const ProjectionMcpRow = Schema.Struct({
	project_id: ProjectId,
	catalog_json: Schema.String,
	provider_id: TrimmedNonEmptyString,
	options_json: Schema.String,
	sequence: Sequence
})
export type ProjectionMcpRow = typeof ProjectionMcpRow.Type

export interface ProjectionMcpShape {
	readonly name: TrimmedNonEmptyString
	readonly apply: (
		event: OrchestrationEvent,
		tx: SqlClient.SqlClient
	) => Effect.Effect<void, SqlError | Schema.SchemaError>
	readonly truncate: (
		tx: SqlClient.SqlClient
	) => Effect.Effect<void, SqlError | Schema.SchemaError>
	readonly get: (
		projectId: ProjectId
	) => Effect.Effect<Option.Option<ProjectedMcpState>, SqlError | Schema.SchemaError>
}

export class ProjectionMcp extends Context.Service<ProjectionMcp, ProjectionMcpShape>()(
	"@acepe/server/persistence/Services/ProjectionMcp"
) {}

const decodeRow = Schema.decodeUnknownEffect(ProjectionMcpRow)
const decodeCatalog = Schema.decodeUnknownEffect(Schema.fromJsonString(ComposerMcpCatalog))
const decodeOptions = Schema.decodeUnknownEffect(Schema.fromJsonString(Schema.Array(ConfigOptionData)))
const encodeCatalog = Schema.encodeEffect(Schema.fromJsonString(ComposerMcpCatalog))
const encodeOptions = Schema.encodeEffect(Schema.fromJsonString(Schema.Array(ConfigOptionData)))

export const encodeProjectedMcpState = Effect.fn("encodeProjectedMcpState")(function*(
	state: ProjectedMcpState
) {
	const catalogJson = yield* encodeCatalog(state.mcpCatalog.catalog)
	const optionsJson = yield* encodeOptions(state.preconnectionOptions.options)
	const sequence =
		state.mcpCatalog.sequence > state.preconnectionOptions.sequence
			? state.mcpCatalog.sequence
			: state.preconnectionOptions.sequence
	return {
		projectId: state.mcpCatalog.projectId,
		catalogJson,
		providerId: state.preconnectionOptions.providerId,
		optionsJson,
		sequence
	}
})

export const decodeStoredProjectedMcpState = Effect.fn("decodeStoredProjectedMcpState")(
	function*(input: unknown) {
		const row = yield* decodeRow(input)
		const catalog = yield* decodeCatalog(row.catalog_json)
		const options = yield* decodeOptions(row.options_json)
		return {
			mcpCatalog: {
				sequence: row.sequence,
				projectId: row.project_id,
				catalog
			},
			preconnectionOptions: {
				sequence: row.sequence,
				projectId: row.project_id,
				providerId: row.provider_id,
				options
			}
		} satisfies ProjectedMcpState
	}
)

const ignoreEvent = (
	current: Option.Option<ProjectedMcpState>
): Effect.Effect<Option.Option<ProjectedMcpState>> => Effect.succeed(current)

const currentOrEmpty = (
	current: Option.Option<ProjectedMcpState>,
	projectId: ProjectId,
	sequence: Sequence
): ProjectedMcpState =>
	Option.getOrElse(current, () => ({
		mcpCatalog: emptyProjectedMcpCatalog(projectId, sequence),
		preconnectionOptions: emptyProjectedPreconnectionOptions(projectId, sequence, "claude-code")
	}))

const forProject = (
	current: Option.Option<ProjectedMcpState>,
	projectId: ProjectId,
	sequence: Sequence
): ProjectedMcpState => {
	const state = currentOrEmpty(current, projectId, sequence)
	if (state.mcpCatalog.projectId !== projectId) {
		return {
			mcpCatalog: emptyProjectedMcpCatalog(projectId, sequence),
			preconnectionOptions: emptyProjectedPreconnectionOptions(projectId, sequence, "claude-code")
		}
	}
	return state
}

const projectCatalogResolved = (
	current: Option.Option<ProjectedMcpState>,
	event: Extract<OrchestrationEvent, { readonly type: "McpCatalogResolved" }>
): Effect.Effect<Option.Option<ProjectedMcpState>, Schema.SchemaError> =>
	Schema.decodeUnknownEffect(McpCatalogResolvedPayload)(event.payload).pipe(
		Effect.map((payload) => {
			const state = forProject(current, payload.projectId, event.sequence)
			return Option.some({
				mcpCatalog: {
					sequence: event.sequence,
					projectId: payload.projectId,
					catalog: payload.catalog
				},
				preconnectionOptions: {
					sequence: state.preconnectionOptions.sequence,
					projectId: payload.projectId,
					providerId: state.preconnectionOptions.providerId,
					options: state.preconnectionOptions.options
				}
			} satisfies ProjectedMcpState)
		})
	)

const projectOptionsLoaded = (
	current: Option.Option<ProjectedMcpState>,
	event: Extract<OrchestrationEvent, { readonly type: "PreconnectionOptionsLoaded" }>
): Effect.Effect<Option.Option<ProjectedMcpState>, Schema.SchemaError> =>
	Schema.decodeUnknownEffect(PreconnectionOptionsLoadedPayload)(event.payload).pipe(
		Effect.map((payload) => {
			const state = forProject(current, payload.projectId, event.sequence)
			return Option.some({
				mcpCatalog: {
					sequence: state.mcpCatalog.sequence,
					projectId: payload.projectId,
					catalog: state.mcpCatalog.catalog
				},
				preconnectionOptions: {
					sequence: event.sequence,
					projectId: payload.projectId,
					providerId: payload.providerId,
					options: payload.options
				}
			} satisfies ProjectedMcpState)
		})
	)

export const evolveProjectedMcpState = (
	current: Option.Option<ProjectedMcpState>,
	event: OrchestrationEvent
): Effect.Effect<Option.Option<ProjectedMcpState>, Schema.SchemaError> =>
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
			SkillsDiscovered: () => ignoreEvent(current),
			VoiceModelsListed: () => ignoreEvent(current),
			VoiceLanguagesListed: () => ignoreEvent(current),
			VoiceModelStatusReported: () => ignoreEvent(current),
			VoiceModelDownloaded: () => ignoreEvent(current),
			VoiceModelDeleted: () => ignoreEvent(current),
			VoiceModelLoaded: () => ignoreEvent(current),
			VoiceRecordingStarted: () => ignoreEvent(current),
			VoiceRecordingStopped: () => ignoreEvent(current),
			VoiceRecordingCancelled: () => ignoreEvent(current),
			GitStatusRefreshed: () => ignoreEvent(current),
			GitDiffLoaded: () => ignoreEvent(current),
			GitBlameLoaded: () => ignoreEvent(current),
			GitHunkAccepted: () => ignoreEvent(current),
			GitHunkRejected: () => ignoreEvent(current),
			SessionResumed: () => ignoreEvent(current),
			SessionForked: () => ignoreEvent(current),
			SessionClosed: () => ignoreEvent(current),
			SessionModelSet: () => ignoreEvent(current),
			SessionModeSet: () => ignoreEvent(current),
			SessionAutonomousSet: () => ignoreEvent(current),
			SessionConfigOptionSet: () => ignoreEvent(current),
			InteractionReplied: () => ignoreEvent(current),
			InboundResponded: () => ignoreEvent(current),
			AgentInitialized: () => ignoreEvent(current),
			AgentInstalled: () => ignoreEvent(current),
			AgentUninstalled: () => ignoreEvent(current),
			AgentAuthenticated: () => ignoreEvent(current),
			AgentAuthenticationCancelled: () => ignoreEvent(current),
			AgentCustomRegistered: () => ignoreEvent(current),
			AgentsListed: () => ignoreEvent(current),
			SessionConnectionRefreshed: () => ignoreEvent(current),
			SessionStateRefreshed: () => ignoreEvent(current),
			TranscriptPageRead: () => ignoreEvent(current),
			TranscriptViewportRequested: () => ignoreEvent(current),
			PreconnectionCapabilitiesListed: () => ignoreEvent(current),
			PreconnectionCommandsListed: () => ignoreEvent(current),
			ComposerMcpCatalogLoaded: () => ignoreEvent(current),
			ComputerUseProbed: () => ignoreEvent(current),
			EventBridgeRefreshed: () => ignoreEvent(current),
			ToolCallObserved: () => ignoreEvent(current),
			ApprovalRequested: () => ignoreEvent(current),
			McpCatalogResolved: (resolved) => projectCatalogResolved(current, resolved),
			PreconnectionOptionsLoaded: (loaded) => projectOptionsLoaded(current, loaded)

		})
	)(event)
