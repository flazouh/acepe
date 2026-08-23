import {
	APP_VOICE_ID,
	emptyProjectedVoice,
	type OrchestrationEvent,
	ProjectedVoice,
	Sequence,
	TrimmedNonEmptyString,
	VoiceLanguageOption,
	VoiceLastTranscription,
	VoiceModelDeletedPayload,
	VoiceModelDownloadedPayload,
	VoiceModelInfo,
	VoiceModelLoadedPayload,
	VoiceModelsListedPayload,
	VoiceLanguagesListedPayload,
	VoiceModelStatusReportedPayload,
	VoiceRecordingCancelledPayload,
	VoiceRecordingStartedPayload,
	VoiceRecordingState,
	VoiceRecordingStoppedPayload
} from "@acepe/contracts"
import * as Arr from "effect/Array"
import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as Match from "effect/Match"
import * as Option from "effect/Option"
import * as Schema from "effect/Schema"
import type * as SqlClient from "effect/unstable/sql/SqlClient"
import type { SqlError } from "effect/unstable/sql/SqlError"

export const PROJECTION_VOICE_NAME = "projection.voice"
export const PROJECTION_VOICE_TABLE = "projection_voice"

export type { ProjectedVoice }

export const ProjectionVoiceRow = Schema.Struct({
	voice_id: Schema.String,
	models_json: Schema.String,
	languages_json: Schema.String,
	recording_json: Schema.String,
	last_transcription_json: Schema.String,
	sequence: Sequence
})
export type ProjectionVoiceRow = typeof ProjectionVoiceRow.Type

export interface ProjectionVoiceShape {
	readonly name: TrimmedNonEmptyString
	readonly apply: (
		event: OrchestrationEvent,
		tx: SqlClient.SqlClient
	) => Effect.Effect<void, SqlError | Schema.SchemaError>
	readonly truncate: (
		tx: SqlClient.SqlClient
	) => Effect.Effect<void, SqlError | Schema.SchemaError>
	readonly get: () => Effect.Effect<Option.Option<ProjectedVoice>, SqlError | Schema.SchemaError>
}

export class ProjectionVoice extends Context.Service<ProjectionVoice, ProjectionVoiceShape>()(
	"@acepe/server/persistence/Services/ProjectionVoice"
) {}

const decodeRow = Schema.decodeUnknownEffect(ProjectionVoiceRow)
const decodeModels = Schema.decodeUnknownEffect(Schema.fromJsonString(Schema.Array(VoiceModelInfo)))
const decodeLanguages = Schema.decodeUnknownEffect(
	Schema.fromJsonString(Schema.Array(VoiceLanguageOption))
)
const decodeRecording = Schema.decodeUnknownEffect(
	Schema.fromJsonString(Schema.NullOr(VoiceRecordingState))
)
const decodeLastTranscription = Schema.decodeUnknownEffect(
	Schema.fromJsonString(Schema.NullOr(VoiceLastTranscription))
)
const encodeModels = Schema.encodeEffect(Schema.fromJsonString(Schema.Array(VoiceModelInfo)))
const encodeLanguages = Schema.encodeEffect(
	Schema.fromJsonString(Schema.Array(VoiceLanguageOption))
)
const encodeRecording = Schema.encodeEffect(Schema.fromJsonString(Schema.NullOr(VoiceRecordingState)))
const encodeLastTranscription = Schema.encodeEffect(
	Schema.fromJsonString(Schema.NullOr(VoiceLastTranscription))
)

export const encodeProjectedVoice = Effect.fn("encodeProjectedVoice")(function*(
	voice: ProjectedVoice
) {
	const modelsJson = yield* encodeModels(voice.models)
	const languagesJson = yield* encodeLanguages(voice.languages)
	const recordingJson = yield* encodeRecording(voice.recording)
	const lastTranscriptionJson = yield* encodeLastTranscription(voice.lastTranscription)
	return {
		voiceId: APP_VOICE_ID,
		modelsJson,
		languagesJson,
		recordingJson,
		lastTranscriptionJson,
		sequence: voice.sequence
	}
})

export const decodeStoredProjectedVoice = Effect.fn("decodeStoredProjectedVoice")(function*(
	input: unknown
) {
	const row = yield* decodeRow(input)
	const models = yield* decodeModels(row.models_json)
	const languages = yield* decodeLanguages(row.languages_json)
	const recording = yield* decodeRecording(row.recording_json)
	const lastTranscription = yield* decodeLastTranscription(row.last_transcription_json)
	return {
		sequence: row.sequence,
		models,
		languages,
		recording,
		lastTranscription
	} satisfies ProjectedVoice
})

const ignoreEvent = (
	current: Option.Option<ProjectedVoice>
): Effect.Effect<Option.Option<ProjectedVoice>> => Effect.succeed(current)

const currentOrEmpty = (
	current: Option.Option<ProjectedVoice>,
	sequence: Sequence
): ProjectedVoice => Option.getOrElse(current, () => emptyProjectedVoice(sequence))

const upsertModel = (
	models: ReadonlyArray<VoiceModelInfo>,
	next: VoiceModelInfo
): ReadonlyArray<VoiceModelInfo> =>
	Option.match(Arr.findFirst(models, (row) => row.id === next.id), {
		onNone: () => Arr.append(models, next),
		onSome: () => Arr.map(models, (row) => (row.id === next.id ? next : row))
	})

const markDownloaded = (
	models: ReadonlyArray<VoiceModelInfo>,
	modelId: string
): ReadonlyArray<VoiceModelInfo> =>
	Arr.map(models, (row) => {
		if (row.id !== modelId) {
			return row
		}
		return {
			id: row.id,
			name: row.name,
			sizeBytes: row.sizeBytes,
			isEnglishOnly: row.isEnglishOnly,
			isDownloaded: true,
			isLoaded: row.isLoaded,
			downloadUrl: row.downloadUrl
		}
	})

const markDeleted = (
	models: ReadonlyArray<VoiceModelInfo>,
	modelId: string
): ReadonlyArray<VoiceModelInfo> =>
	Arr.map(models, (row) => {
		if (row.id !== modelId) {
			return row
		}
		return {
			id: row.id,
			name: row.name,
			sizeBytes: row.sizeBytes,
			isEnglishOnly: row.isEnglishOnly,
			isDownloaded: false,
			isLoaded: false,
			downloadUrl: row.downloadUrl
		}
	})

const withSequence = (voice: ProjectedVoice, sequence: Sequence): ProjectedVoice => ({
	sequence,
	models: voice.models,
	languages: voice.languages,
	recording: voice.recording,
	lastTranscription: voice.lastTranscription
})

const projectModelsListed = (
	current: Option.Option<ProjectedVoice>,
	event: Extract<OrchestrationEvent, { readonly type: "VoiceModelsListed" }>
): Effect.Effect<Option.Option<ProjectedVoice>, Schema.SchemaError> =>
	Schema.decodeUnknownEffect(VoiceModelsListedPayload)(event.payload).pipe(
		Effect.map((payload) => {
			const voice = currentOrEmpty(current, event.sequence)
			return Option.some(
				withSequence(
					{
						sequence: event.sequence,
						models: payload.models,
						languages: voice.languages,
						recording: voice.recording,
						lastTranscription: voice.lastTranscription
					},
					event.sequence
				)
			)
		})
	)

const projectLanguagesListed = (
	current: Option.Option<ProjectedVoice>,
	event: Extract<OrchestrationEvent, { readonly type: "VoiceLanguagesListed" }>
): Effect.Effect<Option.Option<ProjectedVoice>, Schema.SchemaError> =>
	Schema.decodeUnknownEffect(VoiceLanguagesListedPayload)(event.payload).pipe(
		Effect.map((payload) => {
			const voice = currentOrEmpty(current, event.sequence)
			return Option.some({
				sequence: event.sequence,
				models: voice.models,
				languages: payload.languages,
				recording: voice.recording,
				lastTranscription: voice.lastTranscription
			})
		})
	)

const projectModelStatusReported = (
	current: Option.Option<ProjectedVoice>,
	event: Extract<OrchestrationEvent, { readonly type: "VoiceModelStatusReported" }>
): Effect.Effect<Option.Option<ProjectedVoice>, Schema.SchemaError> =>
	Schema.decodeUnknownEffect(VoiceModelStatusReportedPayload)(event.payload).pipe(
		Effect.map((payload) => {
			const voice = currentOrEmpty(current, event.sequence)
			return Option.some({
				sequence: event.sequence,
				models: upsertModel(voice.models, payload.model),
				languages: voice.languages,
				recording: voice.recording,
				lastTranscription: voice.lastTranscription
			})
		})
	)

const projectModelDownloaded = (
	current: Option.Option<ProjectedVoice>,
	event: Extract<OrchestrationEvent, { readonly type: "VoiceModelDownloaded" }>
): Effect.Effect<Option.Option<ProjectedVoice>, Schema.SchemaError> =>
	Schema.decodeUnknownEffect(VoiceModelDownloadedPayload)(event.payload).pipe(
		Effect.map((payload) => {
			const voice = currentOrEmpty(current, event.sequence)
			return Option.some({
				sequence: event.sequence,
				models: markDownloaded(voice.models, payload.modelId),
				languages: voice.languages,
				recording: voice.recording,
				lastTranscription: voice.lastTranscription
			})
		})
	)

const projectModelDeleted = (
	current: Option.Option<ProjectedVoice>,
	event: Extract<OrchestrationEvent, { readonly type: "VoiceModelDeleted" }>
): Effect.Effect<Option.Option<ProjectedVoice>, Schema.SchemaError> =>
	Schema.decodeUnknownEffect(VoiceModelDeletedPayload)(event.payload).pipe(
		Effect.map((payload) => {
			const voice = currentOrEmpty(current, event.sequence)
			return Option.some({
				sequence: event.sequence,
				models: markDeleted(voice.models, payload.modelId),
				languages: voice.languages,
				recording: voice.recording,
				lastTranscription: voice.lastTranscription
			})
		})
	)

const projectModelLoaded = (
	current: Option.Option<ProjectedVoice>,
	event: Extract<OrchestrationEvent, { readonly type: "VoiceModelLoaded" }>
): Effect.Effect<Option.Option<ProjectedVoice>, Schema.SchemaError> =>
	Schema.decodeUnknownEffect(VoiceModelLoadedPayload)(event.payload).pipe(
		Effect.map((payload) => {
			const voice = currentOrEmpty(current, event.sequence)
			return Option.some({
				sequence: event.sequence,
				models: upsertModel(voice.models, payload.model),
				languages: voice.languages,
				recording: voice.recording,
				lastTranscription: voice.lastTranscription
			})
		})
	)

const projectRecordingStarted = (
	current: Option.Option<ProjectedVoice>,
	event: Extract<OrchestrationEvent, { readonly type: "VoiceRecordingStarted" }>
): Effect.Effect<Option.Option<ProjectedVoice>, Schema.SchemaError> =>
	Schema.decodeUnknownEffect(VoiceRecordingStartedPayload)(event.payload).pipe(
		Effect.map((payload) => {
			const voice = currentOrEmpty(current, event.sequence)
			return Option.some({
				sequence: event.sequence,
				models: voice.models,
				languages: voice.languages,
				recording: {
					sessionId: payload.sessionId,
					phase: "recording" as const
				},
				lastTranscription: voice.lastTranscription
			})
		})
	)

const projectRecordingStopped = (
	current: Option.Option<ProjectedVoice>,
	event: Extract<OrchestrationEvent, { readonly type: "VoiceRecordingStopped" }>
): Effect.Effect<Option.Option<ProjectedVoice>, Schema.SchemaError> =>
	Schema.decodeUnknownEffect(VoiceRecordingStoppedPayload)(event.payload).pipe(
		Effect.map((payload) => {
			const voice = currentOrEmpty(current, event.sequence)
			return Option.some({
				sequence: event.sequence,
				models: voice.models,
				languages: voice.languages,
				recording: null,
				lastTranscription: {
					sessionId: payload.sessionId,
					text: payload.result.text,
					language: payload.result.language,
					durationMs: payload.result.durationMs
				}
			})
		})
	)

const projectRecordingCancelled = (
	current: Option.Option<ProjectedVoice>,
	event: Extract<OrchestrationEvent, { readonly type: "VoiceRecordingCancelled" }>
): Effect.Effect<Option.Option<ProjectedVoice>, Schema.SchemaError> =>
	Schema.decodeUnknownEffect(VoiceRecordingCancelledPayload)(event.payload).pipe(
		Effect.map(() => {
			const voice = currentOrEmpty(current, event.sequence)
			return Option.some({
				sequence: event.sequence,
				models: voice.models,
				languages: voice.languages,
				recording: null,
				lastTranscription: voice.lastTranscription
			})
		})
	)

export const evolveProjectedVoice = (
	current: Option.Option<ProjectedVoice>,
	event: OrchestrationEvent
): Effect.Effect<Option.Option<ProjectedVoice>, Schema.SchemaError> =>
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
			VoiceModelsListed: (listed) => projectModelsListed(current, listed),
			VoiceLanguagesListed: (listed) => projectLanguagesListed(current, listed),
			VoiceModelStatusReported: (reported) => projectModelStatusReported(current, reported),
			VoiceModelDownloaded: (downloaded) => projectModelDownloaded(current, downloaded),
			VoiceModelDeleted: (deleted) => projectModelDeleted(current, deleted),
			VoiceModelLoaded: (loaded) => projectModelLoaded(current, loaded),
			VoiceRecordingStarted: (started) => projectRecordingStarted(current, started),
			VoiceRecordingStopped: (stopped) => projectRecordingStopped(current, stopped),
			VoiceRecordingCancelled: (cancelled) => projectRecordingCancelled(current, cancelled),
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
			McpCatalogResolved: () => ignoreEvent(current),
			PreconnectionOptionsLoaded: () => ignoreEvent(current)
		})
	)(event)
