import { describe, expect, it } from "bun:test"
import * as Effect from "effect/Effect"
import * as Exit from "effect/Exit"
import * as Schema from "effect/Schema"
import * as FastCheck from "effect/testing/FastCheck"

import {
	CheckpointCreatedPayload,
	CheckpointReadinessChangedPayload,
	CheckpointRevertedPayload,
	MessageSentPayload,
	OrchestrationEvent,
	ProjectCreatedPayload,
	TokenAppendedPayload,
	ProjectDeletedPayload,
	ProjectMetaUpdatedPayload,
	SessionArchivedPayload,
	SessionCreatedPayload,
	SessionDeletedPayload,
	SessionMetaUpdatedPayload,
	SessionUnarchivedPayload,
	SettingsUpdatedPayload,
	SkillsDiscoveredPayload,
	TurnCancelledPayload,
	VoiceLanguagesListedPayload,
	VoiceModelDeletedPayload,
	VoiceModelDownloadedPayload,
	VoiceModelLoadedPayload,
	VoiceModelStatusReportedPayload,
	VoiceModelsListedPayload,
	VoiceRecordingCancelledPayload,
	VoiceRecordingStartedPayload,
	VoiceRecordingStoppedPayload,
	GitBlameLoadedPayload,
	GitDiffLoadedPayload,
	GitHunkAcceptedPayload,
	GitHunkRejectedPayload,
	GitStatusRefreshedPayload,
} from "./events.ts"
import { CheckpointId, CommandId, EventId, MessageId, ProjectId, SessionId, ToolCallId, TurnId } from "./ids.ts"
import { APP_SETTINGS_ID } from "./settings.ts"
import { APP_SKILLS_ID, emptySkillsCatalog } from "./skills.ts"
import {
	APP_VOICE_ID,
	emptyVoiceLanguages,
	emptyVoiceModels,
	emptyVoiceTranscriptionResult,
	placeholderVoiceModel,
} from "./voice.ts"

const v1EventTypes = [
	"ProjectCreated",
	"ProjectMetaUpdated",
	"ProjectDeleted",
	"SessionCreated",
	"SessionMetaUpdated",
	"SessionArchived",
	"SessionUnarchived",
	"SessionDeleted",
	"MessageSent",
	"TokenAppended",
	"TurnCancelled",
	"CheckpointCreated",
	"CheckpointReadinessChanged",
	"CheckpointReverted",
	"SettingsUpdated",
	"SkillsDiscovered",
	"VoiceModelsListed",
	"VoiceLanguagesListed",
	"VoiceModelStatusReported",
	"VoiceModelDownloaded",
	"VoiceModelDeleted",
	"VoiceModelLoaded",
	"VoiceRecordingStarted",
	"VoiceRecordingStopped",
	"VoiceRecordingCancelled",
	"GitStatusRefreshed",
	"GitDiffLoaded",
	"GitBlameLoaded",
	"GitHunkAccepted",
	"GitHunkRejected",
] as const

type V1EventType = (typeof v1EventTypes)[number]
type EventType = OrchestrationEvent["type"]
type ProjectEventType = Extract<EventType, "ProjectCreated" | "ProjectMetaUpdated" | "ProjectDeleted">
type SettingsEventType = Extract<EventType, "SettingsUpdated">
type SkillsEventType = Extract<EventType, "SkillsDiscovered">
type VoiceEventType = Extract<
	EventType,
	| "VoiceModelsListed"
	| "VoiceLanguagesListed"
	| "VoiceModelStatusReported"
	| "VoiceModelDownloaded"
	| "VoiceModelDeleted"
	| "VoiceModelLoaded"
	| "VoiceRecordingStarted"
	| "VoiceRecordingStopped"
	| "VoiceRecordingCancelled"
>
type GitEventType = Extract<
	EventType,
	| "GitStatusRefreshed"
	| "GitDiffLoaded"
	| "GitBlameLoaded"
	| "GitHunkAccepted"
	| "GitHunkRejected"
>
type SessionEventType = Exclude<
	EventType,
	ProjectEventType | SettingsEventType | SkillsEventType | VoiceEventType | GitEventType
>
const _v1EventTypesMatchUnion: [EventType] extends [V1EventType]
	? [V1EventType] extends [EventType]
		? true
		: never
	: never = true

const envelopeKeys = [
	"sequence",
	"eventId",
	"aggregateKind",
	"aggregateId",
	"occurredAt",
	"commandId",
	"causationEventId",
	"correlationId",
	"metadata",
	"type",
	"payload",
] as const

const updatedAtStyleKey = /updatedAt|modifiedAt|lastModified|lastUpdated|At$/i

const decodeEvent = Schema.decodeUnknownEffect(OrchestrationEvent)
const encodeEvent = Schema.encodeEffect(OrchestrationEvent)

const commandId = CommandId.make("cmd-1")
const eventId = EventId.make("event-1")
const projectId = ProjectId.make("project-1")
const sessionId = SessionId.make("session-1")
const messageId = MessageId.make("message-1")
const turnId = TurnId.make("turn-1")
const checkpointId = CheckpointId.make("checkpoint-1")
const toolCallId = ToolCallId.make("tool-1")
const occurredAt = "2026-08-20T12:00:00.000Z"

const projectEvent = <const Type extends ProjectEventType, Payload>(
	type: Type,
	payload: Payload,
) => ({
	sequence: 1,
	eventId,
	aggregateKind: "project" as const,
	aggregateId: projectId,
	occurredAt,
	commandId,
	causationEventId: null,
	correlationId: commandId,
	metadata: {},
	type,
	payload,
})

const sessionEvent = <const Type extends SessionEventType, Payload>(
	type: Type,
	payload: Payload,
) => ({
	sequence: 2,
	eventId,
	aggregateKind: "session" as const,
	aggregateId: sessionId,
	occurredAt,
	commandId,
	causationEventId: null,
	correlationId: commandId,
	metadata: {},
	type,
	payload,
})

const settingsEvent = <const Type extends SettingsEventType, Payload>(
	type: Type,
	payload: Payload,
) => ({
	sequence: 3,
	eventId,
	aggregateKind: "settings" as const,
	aggregateId: APP_SETTINGS_ID,
	occurredAt,
	commandId,
	causationEventId: null,
	correlationId: commandId,
	metadata: {},
	type,
	payload,
})

const skillsEvent = <const Type extends SkillsEventType, Payload>(
	type: Type,
	payload: Payload,
) => ({
	sequence: 4,
	eventId,
	aggregateKind: "skills" as const,
	aggregateId: APP_SKILLS_ID,
	occurredAt,
	commandId,
	causationEventId: null,
	correlationId: commandId,
	metadata: {},
	type,
	payload,
})

const voiceEvent = <const Type extends VoiceEventType, Payload>(
	type: Type,
	payload: Payload,
) => ({
	sequence: 5,
	eventId,
	aggregateKind: "voice" as const,
	aggregateId: APP_VOICE_ID,
	occurredAt,
	commandId,
	causationEventId: null,
	correlationId: commandId,
	metadata: {},
	type,
	payload,
})

const gitEvent = <const Type extends GitEventType, Payload>(
	type: Type,
	payload: Payload,
) => ({
	sequence: 6,
	eventId,
	aggregateKind: "git" as const,
	aggregateId: projectId,
	occurredAt,
	commandId,
	causationEventId: null,
	correlationId: commandId,
	metadata: {},
	type,
	payload,
})

const memberCases = [
	{
		payloadSchema: ProjectCreatedPayload,
		event: projectEvent("ProjectCreated", {
			projectId,
			title: "Acepe",
			workspaceRoot: "/tmp/acepe",
		}),
	},
	{
		payloadSchema: ProjectMetaUpdatedPayload,
		event: projectEvent("ProjectMetaUpdated", {
			projectId,
			title: "Acepe Desktop",
		}),
	},
	{
		payloadSchema: ProjectDeletedPayload,
		event: projectEvent("ProjectDeleted", {
			projectId,
		}),
	},
	{
		payloadSchema: SessionCreatedPayload,
		event: sessionEvent("SessionCreated", {
			sessionId,
			projectId,
			title: "First session",
		}),
	},
	{
		payloadSchema: SessionMetaUpdatedPayload,
		event: sessionEvent("SessionMetaUpdated", {
			sessionId,
			title: "Renamed session",
		}),
	},
	{
		payloadSchema: SessionArchivedPayload,
		event: sessionEvent("SessionArchived", {
			sessionId,
		}),
	},
	{
		payloadSchema: SessionUnarchivedPayload,
		event: sessionEvent("SessionUnarchived", {
			sessionId,
		}),
	},
	{
		payloadSchema: SessionDeletedPayload,
		event: sessionEvent("SessionDeleted", {
			sessionId,
		}),
	},
	{
		payloadSchema: MessageSentPayload,
		event: sessionEvent("MessageSent", {
			sessionId,
			messageId,
			text: "Ship the lifecycle slice",
		}),
	},
	{
		payloadSchema: TokenAppendedPayload,
		event: sessionEvent("TokenAppended", {
			sessionId,
			messageId,
			token: "Hello",
		}),
	},
	{
		payloadSchema: TurnCancelledPayload,
		event: sessionEvent("TurnCancelled", {
			sessionId,
			turnId,
		}),
	},
	{
		payloadSchema: CheckpointCreatedPayload,
		event: sessionEvent("CheckpointCreated", {
			sessionId,
			checkpointId,
			checkpointNumber: 1,
			name: "After edit",
			isAuto: true,
			toolCallId,
			fileCount: 2,
		}),
	},
	{
		payloadSchema: CheckpointReadinessChangedPayload,
		event: sessionEvent("CheckpointReadinessChanged", {
			sessionId,
			checkpointId,
			status: "ready" as const,
		}),
	},
	{
		payloadSchema: CheckpointRevertedPayload,
		event: sessionEvent("CheckpointReverted", {
			sessionId,
			checkpointId,
		}),
	},
	{
		payloadSchema: SettingsUpdatedPayload,
		event: settingsEvent("SettingsUpdated", {
			key: "ui_font_size" as const,
			value: "14",
		}),
	},
	{
		payloadSchema: SkillsDiscoveredPayload,
		event: skillsEvent("SkillsDiscovered", emptySkillsCatalog),
	},
	{
		payloadSchema: VoiceModelsListedPayload,
		event: voiceEvent("VoiceModelsListed", {
			models: emptyVoiceModels,
		}),
	},
	{
		payloadSchema: VoiceLanguagesListedPayload,
		event: voiceEvent("VoiceLanguagesListed", {
			languages: emptyVoiceLanguages,
		}),
	},
	{
		payloadSchema: VoiceModelStatusReportedPayload,
		event: voiceEvent("VoiceModelStatusReported", {
			modelId: "external",
			model: placeholderVoiceModel("external"),
		}),
	},
	{
		payloadSchema: VoiceModelDownloadedPayload,
		event: voiceEvent("VoiceModelDownloaded", {
			modelId: "external",
		}),
	},
	{
		payloadSchema: VoiceModelDeletedPayload,
		event: voiceEvent("VoiceModelDeleted", {
			modelId: "external",
		}),
	},
	{
		payloadSchema: VoiceModelLoadedPayload,
		event: voiceEvent("VoiceModelLoaded", {
			modelId: "external",
			model: placeholderVoiceModel("external"),
		}),
	},
	{
		payloadSchema: VoiceRecordingStartedPayload,
		event: voiceEvent("VoiceRecordingStarted", {
			sessionId,
		}),
	},
	{
		payloadSchema: VoiceRecordingStoppedPayload,
		event: voiceEvent("VoiceRecordingStopped", {
			sessionId,
			language: null,
			result: emptyVoiceTranscriptionResult,
		}),
	},
	{
		payloadSchema: VoiceRecordingCancelledPayload,
		event: voiceEvent("VoiceRecordingCancelled", {
			sessionId,
		}),
	},
	{
		payloadSchema: GitStatusRefreshedPayload,
		event: gitEvent("GitStatusRefreshed", {
			projectId,
			status: null,
		}),
	},
	{
		payloadSchema: GitDiffLoadedPayload,
		event: gitEvent("GitDiffLoaded", {
			projectId,
			filePath: "notes.md",
			diff: {
				oldContent: "alpha\n",
				newContent: "alpha\nbeta\n",
				fileName: "notes.md",
			},
			patch: "@@ -1,1 +1,2 @@\n alpha\n+beta\n",
		}),
	},
	{
		payloadSchema: GitBlameLoadedPayload,
		event: gitEvent("GitBlameLoaded", {
			projectId,
			filePath: "notes.md",
			blame: [
				{
					line: 1,
					commit: "abc1234",
					author: "Test User",
					summary: "Seed",
				},
			],
		}),
	},
	{
		payloadSchema: GitHunkAcceptedPayload,
		event: gitEvent("GitHunkAccepted", {
			projectId,
			filePath: "notes.md",
			hunkIndex: 0,
		}),
	},
	{
		payloadSchema: GitHunkRejectedPayload,
		event: gitEvent("GitHunkRejected", {
			projectId,
			filePath: "notes.md",
			hunkIndex: 1,
			newContent: "alpha\n",
		}),
	},
] as const

const roundTrip = (event: OrchestrationEvent): void => {
	const encoded = Effect.runSync(encodeEvent(event))
	const decoded = Effect.runSync(decodeEvent(encoded))
	const reencoded = Effect.runSync(encodeEvent(decoded))
	expect(reencoded).toEqual(encoded)
}

describe("OrchestrationEvent", () => {
	it("covers the v1 event types exactly once", () => {
		expect(_v1EventTypesMatchUnion).toBe(true)
		expect(memberCases.map((member) => member.event.type)).toEqual([...v1EventTypes])
	})

	it("carries the envelope fields on every v1 member", () => {
		for (const { event } of memberCases) {
			const decoded = Effect.runSync(decodeEvent(event))
			expect(Object.keys(decoded).sort()).toEqual([...envelopeKeys].sort())
			expect(decoded.sequence).toBe(event.sequence)
			expect(decoded.eventId).toBe(eventId)
			expect(decoded.aggregateKind).toBe(event.aggregateKind)
			expect(decoded.aggregateId).toBe(event.aggregateId)
			expect(decoded.occurredAt).toBe(occurredAt)
			expect(decoded.commandId).toBe(commandId)
			expect(decoded.causationEventId).toBe(null)
			expect(decoded.correlationId).toBe(commandId)
			expect(decoded.metadata).toEqual({})
			expect(decoded.type).toBe(event.type)
			expect(decoded.payload).toEqual(event.payload)
		}
	})

	it("rejects a payload with an unknown type tag", () => {
		const exit = Effect.runSyncExit(
			decodeEvent({
				sequence: 1,
				eventId: "event-1",
				aggregateKind: "project",
				aggregateId: "project-1",
				occurredAt,
				commandId: "cmd-1",
				causationEventId: null,
				correlationId: "cmd-1",
				metadata: {},
				type: "ProviderSynced",
				payload: { projectId: "project-1" },
			}),
		)
		expect(Exit.isFailure(exit)).toBe(true)
	})

	it("round-trips every fixture through encode then decode", () => {
		for (const { event } of memberCases) {
			roundTrip(event)
		}
	})

	it("round-trips TurnCancelled when turnId is absent", () => {
		roundTrip(
			sessionEvent("TurnCancelled", {
				sessionId,
			}),
		)
	})

	it("round-trips SessionMetaUpdated with a pull-request link", () => {
		roundTrip(
			sessionEvent("SessionMetaUpdated", {
				sessionId,
				prNumber: 42,
				prLinkMode: "manual" as const,
			}),
		)
	})

	it("round-trips generated union members", () => {
		const arbitrary = Schema.toArbitrary(OrchestrationEvent)(FastCheck)
		FastCheck.assert(
			FastCheck.property(arbitrary, (event) => {
				roundTrip(event)
			}),
			{ numRuns: 100, seed: 1 },
		)
	})
})

describe("event payloads", () => {
	it("decodes each payload without the envelope", () => {
		for (const { event, payloadSchema } of memberCases) {
			const decoded = Effect.runSync(Schema.decodeUnknownEffect(payloadSchema)(event.payload))
			expect(decoded).toEqual(event.payload)
			expect("sequence" in decoded).toBe(false)
			expect("eventId" in decoded).toBe(false)
			expect("occurredAt" in decoded).toBe(false)
		}
	})

	it("rejects an envelope when decoded as a payload schema", () => {
		const { event, payloadSchema } = memberCases[0]
		const exit = Effect.runSyncExit(Schema.decodeUnknownEffect(payloadSchema)(event))
		expect(Exit.isFailure(exit)).toBe(true)
	})

	for (const { event, payloadSchema } of memberCases) {
		it(`round-trips generated ${event.type} payloads`, () => {
			const arbitrary = Schema.toArbitrary(payloadSchema)(FastCheck)
			FastCheck.assert(
				FastCheck.property(arbitrary, (generated) => {
					const encoded = Effect.runSync(Schema.encodeEffect(payloadSchema)(generated))
					const decoded = Effect.runSync(Schema.decodeUnknownEffect(payloadSchema)(encoded))
					const reencoded = Effect.runSync(Schema.encodeEffect(payloadSchema)(decoded))
					expect(reencoded).toEqual(encoded)
				}),
				{ numRuns: 50, seed: 1 },
			)
		})
	}

	it("has no updatedAt-style field on any payload schema", () => {
		for (const { event, payloadSchema } of memberCases) {
			const keys = Object.keys(payloadSchema.fields)
			const offenders = keys.filter((key) => updatedAtStyleKey.test(key))
			expect({ eventType: event.type, offenders }).toEqual({
				eventType: event.type,
				offenders: [],
			})
		}
	})
})
