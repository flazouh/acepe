import type { IsoDateTime, OrchestrationEvent } from "@acepe/contracts"
import * as Arr from "effect/Array"
import * as Effect from "effect/Effect"
import * as Match from "effect/Match"
import * as Option from "effect/Option"
import * as Schema from "effect/Schema"
import * as SchemaIssue from "effect/SchemaIssue"
import {
	MAX_SESSION_CHECKPOINTS,
	MAX_SESSION_MESSAGES,
	MessageSentPayload,
	type OrchestrationProject,
	type OrchestrationReadModel,
	OrchestrationProjectorDecodeError,
	type OrchestrationSession,
	type OrchestrationSessionMessage,
	ProjectCreatedPayload,
	ProjectDeletedPayload,
	ProjectMetaUpdatedPayload,
	SessionArchivedPayload,
	SessionCreatedPayload,
	SessionDeletedPayload,
	SessionMetaUpdatedPayload,
	SessionUnarchivedPayload,
	TokenAppendedPayload,
	TurnCancelledPayload,
	CheckpointCreatedPayload
} from "./Schemas.ts"

const formatIssue = SchemaIssue.makeFormatterDefault()

const decodePayload = <S extends Schema.Top>(
	schema: S,
	value: unknown,
	eventType: OrchestrationEvent["type"],
	field: string
) =>
	Schema.decodeUnknownEffect(schema)(value).pipe(
		Effect.mapError(
			(error) =>
				new OrchestrationProjectorDecodeError({
					eventType,
					field,
					issue: formatIssue(error.issue)
				})
		)
	)

const retainNewest = <A>(items: ReadonlyArray<A>, limit: number): ReadonlyArray<A> =>
	Arr.takeRight(items, limit)

const capSessionRetention = (session: OrchestrationSession): OrchestrationSession => ({
	...session,
	messages: retainNewest(session.messages, MAX_SESSION_MESSAGES),
	checkpoints: retainNewest(session.checkpoints, MAX_SESSION_CHECKPOINTS)
})

const advanceReadModelCursor = (
	model: OrchestrationReadModel,
	event: OrchestrationEvent
): OrchestrationReadModel => ({
	...model,
	snapshotSequence: event.sequence,
	sessions: model.sessions.map(capSessionRetention),
	updatedAt: event.occurredAt
})

const addOrReplaceById = <Id, Item extends { readonly id: Id }>(
	items: ReadonlyArray<Item>,
	next: Item
): ReadonlyArray<Item> =>
	Option.match(Arr.findFirst(items, (item) => item.id === next.id), {
		onNone: () => Arr.append(items, next),
		onSome: () => items.map((item) => (item.id === next.id ? next : item))
	})

const updateProject = (
	model: OrchestrationReadModel,
	projectId: OrchestrationProject["id"],
	update: (project: OrchestrationProject) => OrchestrationProject
): OrchestrationReadModel => ({
	...model,
	projects: model.projects.map((project) => (project.id === projectId ? update(project) : project))
})

const updateSession = (
	model: OrchestrationReadModel,
	sessionId: OrchestrationSession["id"],
	update: (session: OrchestrationSession) => OrchestrationSession
): OrchestrationReadModel => ({
	...model,
	sessions: model.sessions.map((session) => (session.id === sessionId ? update(session) : session))
})

export const createEmptyReadModel = (nowIso: IsoDateTime): OrchestrationReadModel => ({
	snapshotSequence: 0,
	projects: [],
	sessions: [],
	updatedAt: nowIso
})

const projectProjectCreated = (
	model: OrchestrationReadModel,
	event: Extract<OrchestrationEvent, { readonly type: "ProjectCreated" }>
): Effect.Effect<OrchestrationReadModel, OrchestrationProjectorDecodeError> =>
	decodePayload(ProjectCreatedPayload, event.payload, event.type, "payload").pipe(
		Effect.map((payload) => {
			const project: OrchestrationProject = {
				id: payload.projectId,
				title: payload.title,
				workspaceRoot: payload.workspaceRoot,
				createdAt: event.occurredAt,
				updatedAt: event.occurredAt,
				deletedAt: null
			}
			return {
				...model,
				projects: addOrReplaceById(model.projects, project)
			}
		})
	)

const projectProjectMetaUpdated = (
	model: OrchestrationReadModel,
	event: Extract<OrchestrationEvent, { readonly type: "ProjectMetaUpdated" }>
): Effect.Effect<OrchestrationReadModel, OrchestrationProjectorDecodeError> =>
	decodePayload(ProjectMetaUpdatedPayload, event.payload, event.type, "payload").pipe(
		Effect.map((payload) =>
			updateProject(model, payload.projectId, (project) => ({
				...project,
				title: payload.title !== undefined ? payload.title : project.title,
				workspaceRoot:
					payload.workspaceRoot !== undefined ? payload.workspaceRoot : project.workspaceRoot,
				updatedAt: event.occurredAt
			}))
		)
	)

const projectProjectDeleted = (
	model: OrchestrationReadModel,
	event: Extract<OrchestrationEvent, { readonly type: "ProjectDeleted" }>
): Effect.Effect<OrchestrationReadModel, OrchestrationProjectorDecodeError> =>
	decodePayload(ProjectDeletedPayload, event.payload, event.type, "payload").pipe(
		Effect.map((payload) =>
			updateProject(model, payload.projectId, (project) => ({
				...project,
				updatedAt: event.occurredAt,
				deletedAt: event.occurredAt
			}))
		)
	)

const emptySession = (
	payload: typeof SessionCreatedPayload.Type,
	occurredAt: IsoDateTime
): OrchestrationSession => ({
	id: payload.sessionId,
	projectId: payload.projectId,
	title: payload.title,
	createdAt: occurredAt,
	updatedAt: occurredAt,
	archivedAt: null,
	deletedAt: null,
	messages: [],
	checkpoints: []
})

const projectSessionCreated = (
	model: OrchestrationReadModel,
	event: Extract<OrchestrationEvent, { readonly type: "SessionCreated" }>
): Effect.Effect<OrchestrationReadModel, OrchestrationProjectorDecodeError> =>
	decodePayload(SessionCreatedPayload, event.payload, event.type, "payload").pipe(
		Effect.map((payload) => ({
			...model,
			sessions: addOrReplaceById(model.sessions, emptySession(payload, event.occurredAt))
		}))
	)

const projectSessionMetaUpdated = (
	model: OrchestrationReadModel,
	event: Extract<OrchestrationEvent, { readonly type: "SessionMetaUpdated" }>
): Effect.Effect<OrchestrationReadModel, OrchestrationProjectorDecodeError> =>
	decodePayload(SessionMetaUpdatedPayload, event.payload, event.type, "payload").pipe(
		Effect.map((payload) =>
			updateSession(model, payload.sessionId, (session) => ({
				...session,
				title: payload.title !== undefined ? payload.title : session.title,
				updatedAt: event.occurredAt
			}))
		)
	)

const projectSessionArchived = (
	model: OrchestrationReadModel,
	event: Extract<OrchestrationEvent, { readonly type: "SessionArchived" }>
): Effect.Effect<OrchestrationReadModel, OrchestrationProjectorDecodeError> =>
	decodePayload(SessionArchivedPayload, event.payload, event.type, "payload").pipe(
		Effect.map((payload) =>
			updateSession(model, payload.sessionId, (session) => ({
				...session,
				updatedAt: event.occurredAt,
				archivedAt: event.occurredAt
			}))
		)
	)

const projectSessionUnarchived = (
	model: OrchestrationReadModel,
	event: Extract<OrchestrationEvent, { readonly type: "SessionUnarchived" }>
): Effect.Effect<OrchestrationReadModel, OrchestrationProjectorDecodeError> =>
	decodePayload(SessionUnarchivedPayload, event.payload, event.type, "payload").pipe(
		Effect.map((payload) =>
			updateSession(model, payload.sessionId, (session) => ({
				...session,
				updatedAt: event.occurredAt,
				archivedAt: null
			}))
		)
	)

const projectSessionDeleted = (
	model: OrchestrationReadModel,
	event: Extract<OrchestrationEvent, { readonly type: "SessionDeleted" }>
): Effect.Effect<OrchestrationReadModel, OrchestrationProjectorDecodeError> =>
	decodePayload(SessionDeletedPayload, event.payload, event.type, "payload").pipe(
		Effect.map((payload) =>
			updateSession(model, payload.sessionId, (session) => ({
				...session,
				updatedAt: event.occurredAt,
				deletedAt: event.occurredAt
			}))
		)
	)

const upsertMessage = (
	messages: ReadonlyArray<OrchestrationSessionMessage>,
	message: OrchestrationSessionMessage
): ReadonlyArray<OrchestrationSessionMessage> =>
	retainNewest(addOrReplaceById(messages, message), MAX_SESSION_MESSAGES)

const projectMessageSent = (
	model: OrchestrationReadModel,
	event: Extract<OrchestrationEvent, { readonly type: "MessageSent" }>
): Effect.Effect<OrchestrationReadModel, OrchestrationProjectorDecodeError> =>
	decodePayload(MessageSentPayload, event.payload, event.type, "payload").pipe(
		Effect.map((payload) =>
			updateSession(model, payload.sessionId, (session) => {
				const message: OrchestrationSessionMessage = {
					id: payload.messageId,
					text: payload.text,
					createdAt: event.occurredAt
				}
				return {
					...session,
					updatedAt: event.occurredAt,
					messages: upsertMessage(session.messages, message)
				}
			})
		)
	)

const concatenatedText = (
	current: OrchestrationSessionMessage,
	token: string
): OrchestrationSessionMessage => ({
	id: current.id,
	text: `${current.text}${token}`,
	createdAt: current.createdAt
})

const projectTokenAppended = (
	model: OrchestrationReadModel,
	event: Extract<OrchestrationEvent, { readonly type: "TokenAppended" }>
): Effect.Effect<OrchestrationReadModel, OrchestrationProjectorDecodeError> =>
	decodePayload(TokenAppendedPayload, event.payload, event.type, "payload").pipe(
		Effect.map((payload) =>
			updateSession(model, payload.sessionId, (session) => {
				const existing = Arr.findFirst(
					session.messages,
					(message) => message.id === payload.messageId
				)
				const message: OrchestrationSessionMessage = Option.match(existing, {
					onNone: () => ({
						id: payload.messageId,
						text: payload.token,
						createdAt: event.occurredAt
					}),
					onSome: (current) => concatenatedText(current, payload.token)
				})
				return {
					...session,
					updatedAt: event.occurredAt,
					messages: upsertMessage(session.messages, message)
				}
			})
		)
	)

const projectTurnCancelled = (
	model: OrchestrationReadModel,
	event: Extract<OrchestrationEvent, { readonly type: "TurnCancelled" }>
): Effect.Effect<OrchestrationReadModel, OrchestrationProjectorDecodeError> =>
	decodePayload(TurnCancelledPayload, event.payload, event.type, "payload").pipe(
		Effect.map((payload) =>
			updateSession(model, payload.sessionId, (session) => ({
				...session,
				updatedAt: event.occurredAt
			}))
		)
	)

const projectCheckpointCreated = (
	model: OrchestrationReadModel,
	event: Extract<OrchestrationEvent, { readonly type: "CheckpointCreated" }>
): Effect.Effect<OrchestrationReadModel, OrchestrationProjectorDecodeError> =>
	decodePayload(CheckpointCreatedPayload, event.payload, event.type, "payload").pipe(
		Effect.map((payload) =>
			updateSession(model, payload.sessionId, (session) => ({
				...session,
				updatedAt: event.occurredAt,
				checkpoints: retainNewest(
					addOrReplaceById(session.checkpoints, {
						id: payload.checkpointId,
						createdAt: event.occurredAt
					}),
					MAX_SESSION_CHECKPOINTS
				)
			}))
		)
	)

export const projectEvent = (
	readModel: OrchestrationReadModel,
	event: OrchestrationEvent
): Effect.Effect<OrchestrationReadModel, OrchestrationProjectorDecodeError> => {
	const model = advanceReadModelCursor(readModel, event)
	return Match.type<OrchestrationEvent>().pipe(
		Match.discriminatorsExhaustive("type")({
			ProjectCreated: (created) => projectProjectCreated(model, created),
			ProjectMetaUpdated: (updated) => projectProjectMetaUpdated(model, updated),
			ProjectDeleted: (deleted) => projectProjectDeleted(model, deleted),
			SessionCreated: (created) => projectSessionCreated(model, created),
			SessionMetaUpdated: (updated) => projectSessionMetaUpdated(model, updated),
			SessionArchived: (archived) => projectSessionArchived(model, archived),
			SessionUnarchived: (unarchived) => projectSessionUnarchived(model, unarchived),
			SessionDeleted: (deleted) => projectSessionDeleted(model, deleted),
			MessageSent: (sent) => projectMessageSent(model, sent),
			TokenAppended: (appended) => projectTokenAppended(model, appended),
			TurnCancelled: (cancelled) => projectTurnCancelled(model, cancelled),
			CheckpointCreated: (created) => projectCheckpointCreated(model, created),
			CheckpointReadinessChanged: () => Effect.succeed(model),
			CheckpointReverted: () => Effect.succeed(model),
			CheckpointFileReverted: () => Effect.succeed(model),
			SettingsUpdated: () => Effect.succeed(model),
			SkillsDiscovered: () => Effect.succeed(model),
			VoiceModelsListed: () => Effect.succeed(model),
			VoiceLanguagesListed: () => Effect.succeed(model),
			VoiceModelStatusReported: () => Effect.succeed(model),
			VoiceModelDownloaded: () => Effect.succeed(model),
			VoiceModelDeleted: () => Effect.succeed(model),
			VoiceModelLoaded: () => Effect.succeed(model),
			VoiceRecordingStarted: () => Effect.succeed(model),
			VoiceRecordingStopped: () => Effect.succeed(model),
			VoiceRecordingCancelled: () => Effect.succeed(model),
			GitStatusRefreshed: () => Effect.succeed(model),
			GitDiffLoaded: () => Effect.succeed(model),
			GitBlameLoaded: () => Effect.succeed(model),
			GitHunkAccepted: () => Effect.succeed(model),
			GitHunkRejected: () => Effect.succeed(model),
			SessionResumed: () => Effect.succeed(model),
			SessionForked: () => Effect.succeed(model),
			SessionClosed: () => Effect.succeed(model),
			SessionModelSet: () => Effect.succeed(model),
			SessionModeSet: () => Effect.succeed(model),
			SessionAutonomousSet: () => Effect.succeed(model),
			SessionConfigOptionSet: () => Effect.succeed(model),
			InteractionReplied: () => Effect.succeed(model),
			InboundResponded: () => Effect.succeed(model),
			AgentInitialized: () => Effect.succeed(model),
			AgentInstalled: () => Effect.succeed(model),
			AgentUninstalled: () => Effect.succeed(model),
			AgentAuthenticated: () => Effect.succeed(model),
			AgentAuthenticationCancelled: () => Effect.succeed(model),
			AgentCustomRegistered: () => Effect.succeed(model),
			AgentsListed: () => Effect.succeed(model),
			SessionConnectionRefreshed: () => Effect.succeed(model),
			SessionStateRefreshed: () => Effect.succeed(model),
			TranscriptPageRead: () => Effect.succeed(model),
			TranscriptViewportRequested: () => Effect.succeed(model),
			PreconnectionCapabilitiesListed: () => Effect.succeed(model),
			PreconnectionCommandsListed: () => Effect.succeed(model),
			ComposerMcpCatalogLoaded: () => Effect.succeed(model),
			ComputerUseProbed: () => Effect.succeed(model),
			EventBridgeRefreshed: () => Effect.succeed(model),
			ToolCallObserved: () => Effect.succeed(model),
			ApprovalRequested: () => Effect.succeed(model),
			McpCatalogResolved: () => Effect.succeed(model),
			PreconnectionOptionsLoaded: () => Effect.succeed(model)
		})
	)(event)
}
