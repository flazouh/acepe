import {
	CommandId,
	EventId,
	MessageId,
	MessageSendCommand,
	ProjectCreateCommand,
	ProjectDeleteCommand,
	ProjectId,
	ProjectMetaUpdateCommand,
	ReviewFileMarkReviewedCommand,
	ReviewSessionClearCommand,
	SessionArchiveCommand,
	SessionCreateCommand,
	SessionDeleteCommand,
	SessionId,
	SessionMetaUpdateCommand,
	SessionUnarchiveCommand,
	TokenAppendCommand,
	TurnCancelCommand,
	TurnId,
	CheckpointCreateCommand,
	CheckpointId,
	CheckpointReportReadinessCommand,
	CheckpointRevertCommand,
	SettingsSetCommand,
	SkillsDiscoverCommand,
	ToolCallId,
	VoiceModelsListCommand,
	APP_SETTINGS_ID,
	APP_SKILLS_ID,
	APP_VOICE_ID,
	emptySkillsCatalog,
	emptyVoiceModels
} from "@acepe/contracts"
import * as Vitest from "@effect/vitest"
import * as Effect from "effect/Effect"
import type { OrchestrationReadModel } from "./commandInvariants.ts"
import { type DecideIdentity, decide } from "./decider.ts"

const occurredAt = "2026-08-20T12:00:00.000Z"
const laterOccurredAt = "2026-08-20T13:00:00.000Z"
const commandId = CommandId.make("cmd-1")
const eventId = EventId.make("event-1")
const otherEventId = EventId.make("event-2")
const projectId = ProjectId.make("project-1")
const sessionId = SessionId.make("session-1")
const messageId = MessageId.make("message-1")
const turnId = TurnId.make("turn-1")
const checkpointId = CheckpointId.make("checkpoint-1")
const toolCallId = ToolCallId.make("tool-1")

const identity: DecideIdentity = {
	eventId,
	occurredAt
}

const emptyReadModel: OrchestrationReadModel = {
	snapshotSequence: 0,
	projects: [],
	sessions: []
}

const projectReadModel: OrchestrationReadModel = {
	snapshotSequence: 1,
	projects: [{ id: projectId }],
	sessions: []
}

const sessionReadModel: OrchestrationReadModel = {
	snapshotSequence: 2,
	projects: [{ id: projectId }],
	sessions: [
		{
			id: sessionId,
			projectId,
			archivedAt: null,
			checkpoints: []
		}
	]
}

const archivedSessionReadModel: OrchestrationReadModel = {
	snapshotSequence: 3,
	projects: [{ id: projectId }],
	sessions: [
		{
			id: sessionId,
			projectId,
			archivedAt: occurredAt,
			checkpoints: []
		}
	]
}

const checkpointReadModel: OrchestrationReadModel = {
	snapshotSequence: 3,
	projects: [{ id: projectId }],
	sessions: [
		{
			id: sessionId,
			projectId,
			archivedAt: null,
			checkpoints: [{ id: checkpointId }]
		}
	]
}

const createProjectCommand = ProjectCreateCommand.make({
	type: "project.create",
	commandId,
	projectId,
	title: "Acepe",
	workspaceRoot: "/tmp/acepe"
})

const secondProjectId = ProjectId.make("project-2")

const workspaceRootReadModel: OrchestrationReadModel = {
	snapshotSequence: 1,
	projects: [{ id: projectId, workspaceRoot: "/tmp/acepe" }],
	sessions: []
}

const createSecondProjectSameRootCommand = ProjectCreateCommand.make({
	type: "project.create",
	commandId,
	projectId: secondProjectId,
	title: "Acepe (second)",
	workspaceRoot: "/tmp/acepe"
})

Vitest.describe("decide", () => {
	Vitest.it.effect("emits identical events when run twice with the same inputs", () =>
		Effect.gen(function*() {
			const first = yield* decide(emptyReadModel, createProjectCommand, identity)
			const second = yield* decide(emptyReadModel, createProjectCommand, identity)
			Vitest.assert.deepStrictEqual(first, second)
			Vitest.assert.deepStrictEqual(first, [
				{
					sequence: 1,
					eventId,
					aggregateKind: "project",
					aggregateId: projectId,
					occurredAt,
					commandId,
					causationEventId: null,
					correlationId: commandId,
					metadata: {},
					type: "ProjectCreated",
					payload: {
						projectId,
						title: "Acepe",
						workspaceRoot: "/tmp/acepe"
					}
				}
			])
		})
	)

	Vitest.it.effect("uses the injected event id and timestamp rather than generating them inline", () =>
		Effect.gen(function*() {
			const events = yield* decide(emptyReadModel, createProjectCommand, {
				eventId: otherEventId,
				occurredAt: laterOccurredAt
			})
			const event = events[0]
			Vitest.assert.isDefined(event)
			Vitest.assert.strictEqual(event.eventId, otherEventId)
			Vitest.assert.strictEqual(event.occurredAt, laterOccurredAt)
		})
	)

	Vitest.it.effect("rejects project.create when the project already exists", () =>
		Effect.gen(function*() {
			const error = yield* Effect.flip(
				decide(projectReadModel, createProjectCommand, identity)
			)
			Vitest.assert.strictEqual(error._tag, "OrchestrationCommandInvariantError")
			Vitest.assert.strictEqual(
				error.detail,
				"Project 'project-1' already exists and cannot be created twice."
			)
		})
	)

	// Regression (AC #266): two distinct projects dispatched for the same
	// workspace_root crashed the agent panel client-side with a Svelte
	// each_key_duplicate (a list keyed by workspace root). The decider must
	// reject the second project.create instead of ever committing a second
	// ProjectCreated event for a workspace_root another project already
	// claims -- even though `projectId` itself is distinct and would
	// otherwise pass requireProjectAbsent.
	Vitest.it.effect("rejects project.create when another project already claims the workspace root", () =>
		Effect.gen(function*() {
			const error = yield* Effect.flip(
				decide(workspaceRootReadModel, createSecondProjectSameRootCommand, identity)
			)
			Vitest.assert.strictEqual(error._tag, "OrchestrationCommandInvariantError")
			Vitest.assert.strictEqual(
				error.detail,
				"Workspace root '/tmp/acepe' is already claimed by project 'project-1'."
			)
		})
	)

	Vitest.it.effect("emits ProjectMetaUpdated from the command fields", () =>
		Effect.gen(function*() {
			const events = yield* decide(
				projectReadModel,
				ProjectMetaUpdateCommand.make({
					type: "project.meta.update",
					commandId,
					projectId,
					title: "Acepe Desktop"
				}),
				identity
			)
			Vitest.assert.deepStrictEqual(events, [
				{
					sequence: 2,
					eventId,
					aggregateKind: "project",
					aggregateId: projectId,
					occurredAt,
					commandId,
					causationEventId: null,
					correlationId: commandId,
					metadata: {},
					type: "ProjectMetaUpdated",
					payload: {
						projectId,
						title: "Acepe Desktop"
					}
				}
			])
		})
	)

	Vitest.it.effect("emits ProjectDeleted when the project exists", () =>
		Effect.gen(function*() {
			const events = yield* decide(
				projectReadModel,
				ProjectDeleteCommand.make({
					type: "project.delete",
					commandId,
					projectId
				}),
				identity
			)
			Vitest.assert.deepStrictEqual(events, [
				{
					sequence: 2,
					eventId,
					aggregateKind: "project",
					aggregateId: projectId,
					occurredAt,
					commandId,
					causationEventId: null,
					correlationId: commandId,
					metadata: {},
					type: "ProjectDeleted",
					payload: { projectId }
				}
			])
		})
	)

	Vitest.it.effect("emits SessionCreated when the project exists and the session is absent", () =>
		Effect.gen(function*() {
			const events = yield* decide(
				projectReadModel,
				SessionCreateCommand.make({
					type: "session.create",
					commandId,
					sessionId,
					projectId,
					title: "First session"
				}),
				identity
			)
			Vitest.assert.deepStrictEqual(events, [
				{
					sequence: 2,
					eventId,
					aggregateKind: "session",
					aggregateId: sessionId,
					occurredAt,
					commandId,
					causationEventId: null,
					correlationId: commandId,
					metadata: {},
					type: "SessionCreated",
					payload: {
						sessionId,
						projectId,
						title: "First session"
					}
				}
			])
		})
	)

	Vitest.it.effect("carries providerId into the SessionCreated payload", () =>
		Effect.gen(function*() {
			const events = yield* decide(
				projectReadModel,
				SessionCreateCommand.make({
					type: "session.create",
					commandId,
					sessionId,
					projectId,
					title: "First session",
					providerId: "claude-code"
				}),
				identity
			)
			Vitest.assert.deepStrictEqual(events, [
				{
					sequence: 2,
					eventId,
					aggregateKind: "session",
					aggregateId: sessionId,
					occurredAt,
					commandId,
					causationEventId: null,
					correlationId: commandId,
					metadata: {},
					type: "SessionCreated",
					payload: {
						sessionId,
						projectId,
						title: "First session",
						providerId: "claude-code"
					}
				}
			])
		})
	)

	// The ship card opens a session to write a commit message and PR copy and
	// closes it again. Without this marker on the event, the projected row
	// cannot be told apart from a thread the user started, and the sidebar
	// lists it.
	Vitest.it.effect("carries ephemeral into the SessionCreated payload", () =>
		Effect.gen(function*() {
			const events = yield* decide(
				projectReadModel,
				SessionCreateCommand.make({
					type: "session.create",
					commandId,
					sessionId,
					projectId,
					title: "First session",
					providerId: "claude-code",
					ephemeral: true
				}),
				identity
			)
			Vitest.assert.deepStrictEqual(events, [
				{
					sequence: 2,
					eventId,
					aggregateKind: "session",
					aggregateId: sessionId,
					occurredAt,
					commandId,
					causationEventId: null,
					correlationId: commandId,
					metadata: {},
					type: "SessionCreated",
					payload: {
						sessionId,
						projectId,
						title: "First session",
						providerId: "claude-code",
						ephemeral: true
					}
				}
			])
		})
	)

	Vitest.it.effect("rejects session.create when the project is missing", () =>
		Effect.gen(function*() {
			const error = yield* Effect.flip(
				decide(
					emptyReadModel,
					SessionCreateCommand.make({
						type: "session.create",
						commandId,
						sessionId,
						projectId,
						title: "First session"
					}),
					identity
				)
			)
			Vitest.assert.strictEqual(
				error.detail,
				"Project 'project-1' does not exist for command 'session.create'."
			)
		})
	)

	Vitest.it.effect("emits SessionMetaUpdated from the command fields", () =>
		Effect.gen(function*() {
			const events = yield* decide(
				sessionReadModel,
				SessionMetaUpdateCommand.make({
					type: "session.meta.update",
					commandId,
					sessionId,
					title: "Renamed session"
				}),
				identity
			)
			Vitest.assert.deepStrictEqual(events, [
				{
					sequence: 3,
					eventId,
					aggregateKind: "session",
					aggregateId: sessionId,
					occurredAt,
					commandId,
					causationEventId: null,
					correlationId: commandId,
					metadata: {},
					type: "SessionMetaUpdated",
					payload: {
						sessionId,
						title: "Renamed session"
					}
				}
			])
		})
	)

	Vitest.it.effect("emits SessionMetaUpdated pull-request fields from the command", () =>
		Effect.gen(function*() {
			const events = yield* decide(
				sessionReadModel,
				SessionMetaUpdateCommand.make({
					type: "session.meta.update",
					commandId,
					sessionId,
					prNumber: 42,
					prLinkMode: "manual"
				}),
				identity
			)
			Vitest.assert.deepStrictEqual(events, [
				{
					sequence: 3,
					eventId,
					aggregateKind: "session",
					aggregateId: sessionId,
					occurredAt,
					commandId,
					causationEventId: null,
					correlationId: commandId,
					metadata: {},
					type: "SessionMetaUpdated",
					payload: {
						sessionId,
						prNumber: 42,
						prLinkMode: "manual"
					}
				}
			])
		})
	)

	Vitest.it.effect("emits SessionArchived for a live session", () =>
		Effect.gen(function*() {
			const events = yield* decide(
				sessionReadModel,
				SessionArchiveCommand.make({
					type: "session.archive",
					commandId,
					sessionId
				}),
				identity
			)
			Vitest.assert.deepStrictEqual(events, [
				{
					sequence: 3,
					eventId,
					aggregateKind: "session",
					aggregateId: sessionId,
					occurredAt,
					commandId,
					causationEventId: null,
					correlationId: commandId,
					metadata: {},
					type: "SessionArchived",
					payload: { sessionId }
				}
			])
		})
	)

	Vitest.it.effect("emits SessionUnarchived for an archived session", () =>
		Effect.gen(function*() {
			const events = yield* decide(
				archivedSessionReadModel,
				SessionUnarchiveCommand.make({
					type: "session.unarchive",
					commandId,
					sessionId
				}),
				identity
			)
			Vitest.assert.deepStrictEqual(events, [
				{
					sequence: 4,
					eventId,
					aggregateKind: "session",
					aggregateId: sessionId,
					occurredAt,
					commandId,
					causationEventId: null,
					correlationId: commandId,
					metadata: {},
					type: "SessionUnarchived",
					payload: { sessionId }
				}
			])
		})
	)

	Vitest.it.effect("rejects session.unarchive when the session is not archived", () =>
		Effect.gen(function*() {
			const error = yield* Effect.flip(
				decide(
					sessionReadModel,
					SessionUnarchiveCommand.make({
						type: "session.unarchive",
						commandId,
						sessionId
					}),
					identity
				)
			)
			Vitest.assert.strictEqual(
				error.detail,
				"Session 'session-1' is not archived for command 'session.unarchive'."
			)
		})
	)

	Vitest.it.effect("emits SessionDeleted when the session exists", () =>
		Effect.gen(function*() {
			const events = yield* decide(
				archivedSessionReadModel,
				SessionDeleteCommand.make({
					type: "session.delete",
					commandId,
					sessionId
				}),
				identity
			)
			Vitest.assert.deepStrictEqual(events, [
				{
					sequence: 4,
					eventId,
					aggregateKind: "session",
					aggregateId: sessionId,
					occurredAt,
					commandId,
					causationEventId: null,
					correlationId: commandId,
					metadata: {},
					type: "SessionDeleted",
					payload: { sessionId }
				}
			])
		})
	)

	Vitest.it.effect("emits MessageSent for a live session", () =>
		Effect.gen(function*() {
			const events = yield* decide(
				sessionReadModel,
				MessageSendCommand.make({
					type: "message.send",
					commandId,
					sessionId,
					messageId,
					text: "Ship the lifecycle slice"
				}),
				identity
			)
			Vitest.assert.deepStrictEqual(events, [
				{
					sequence: 3,
					eventId,
					aggregateKind: "session",
					aggregateId: sessionId,
					occurredAt,
					commandId,
					causationEventId: null,
					correlationId: commandId,
					metadata: {},
					type: "MessageSent",
					payload: {
						sessionId,
						messageId,
						text: "Ship the lifecycle slice"
					}
				}
			])
		})
	)

	Vitest.it.effect("emits TokenAppended for a live session", () =>
		Effect.gen(function*() {
			const events = yield* decide(
				sessionReadModel,
				TokenAppendCommand.make({
					type: "token.append",
					commandId,
					sessionId,
					messageId,
					token: "Hello"
				}),
				identity
			)
			Vitest.assert.deepStrictEqual(events, [
				{
					sequence: 3,
					eventId,
					aggregateKind: "session",
					aggregateId: sessionId,
					occurredAt,
					commandId,
					causationEventId: null,
					correlationId: commandId,
					metadata: {},
					type: "TokenAppended",
					payload: {
						sessionId,
						messageId,
						token: "Hello"
					}
				}
			])
		})
	)

	Vitest.it.effect("rejects token.append when the session is archived", () =>
		Effect.gen(function*() {
			const error = yield* Effect.flip(
				decide(
					archivedSessionReadModel,
					TokenAppendCommand.make({
						type: "token.append",
						commandId,
						sessionId,
						messageId,
						token: "Hello"
					}),
					identity
				)
			)
			Vitest.assert.strictEqual(error._tag, "OrchestrationCommandInvariantError")
			Vitest.assert.strictEqual(
				error.detail,
				"Session 'session-1' is already archived and cannot handle command 'token.append'."
			)
		})
	)

	Vitest.it.effect("rejects message.send when the session is archived", () =>
		Effect.gen(function*() {
			const error = yield* Effect.flip(
				decide(
					archivedSessionReadModel,
					MessageSendCommand.make({
						type: "message.send",
						commandId,
						sessionId,
						messageId,
						text: "Ship the lifecycle slice"
					}),
					identity
				)
			)
			Vitest.assert.strictEqual(
				error.detail,
				"Session 'session-1' is already archived and cannot handle command 'message.send'."
			)
		})
	)

	Vitest.it.effect("emits TurnCancelled with the optional turn id", () =>
		Effect.gen(function*() {
			const events = yield* decide(
				sessionReadModel,
				TurnCancelCommand.make({
					type: "turn.cancel",
					commandId,
					sessionId,
					turnId
				}),
				identity
			)
			Vitest.assert.deepStrictEqual(events, [
				{
					sequence: 3,
					eventId,
					aggregateKind: "session",
					aggregateId: sessionId,
					occurredAt,
					commandId,
					causationEventId: null,
					correlationId: commandId,
					metadata: {},
					type: "TurnCancelled",
					payload: {
						sessionId,
						turnId
					}
				}
			])
		})
	)

	Vitest.it.effect("emits TurnCancelled without a turn id when the command omits it", () =>
		Effect.gen(function*() {
			const events = yield* decide(
				sessionReadModel,
				TurnCancelCommand.make({
					type: "turn.cancel",
					commandId,
					sessionId
				}),
				identity
			)
			Vitest.assert.deepStrictEqual(events, [
				{
					sequence: 3,
					eventId,
					aggregateKind: "session",
					aggregateId: sessionId,
					occurredAt,
					commandId,
					causationEventId: null,
					correlationId: commandId,
					metadata: {},
					type: "TurnCancelled",
					payload: { sessionId }
				}
			])
		})
	)

	Vitest.it.effect("emits CheckpointCreated from checkpoint.create", () =>
		Effect.gen(function*() {
			const events = yield* decide(
				sessionReadModel,
				CheckpointCreateCommand.make({
					type: "checkpoint.create",
					commandId,
					sessionId,
					checkpointId,
					checkpointNumber: 1,
					name: "After edit",
					isAuto: true,
					toolCallId,
					fileCount: 2,
					projectPath: null,
					worktreePath: null,
					modifiedFiles: []
				}),
				identity
			)
			Vitest.assert.deepStrictEqual(events, [
				{
					sequence: 3,
					eventId,
					aggregateKind: "session",
					aggregateId: sessionId,
					occurredAt,
					commandId,
					causationEventId: null,
					correlationId: commandId,
					metadata: {},
					type: "CheckpointCreated",
					payload: {
						sessionId,
						checkpointId,
						checkpointNumber: 1,
						name: "After edit",
						isAuto: true,
						toolCallId,
						fileCount: 2
					}
				}
			])
		})
	)

	Vitest.it.effect("emits CheckpointReadinessChanged from checkpoint.report-readiness", () =>
		Effect.gen(function*() {
			const events = yield* decide(
				checkpointReadModel,
				CheckpointReportReadinessCommand.make({
					type: "checkpoint.report-readiness",
					commandId,
					sessionId,
					checkpointId,
					status: "ready"
				}),
				identity
			)
			Vitest.assert.strictEqual(events[0]?.type, "CheckpointReadinessChanged")
			if (events[0]?.type === "CheckpointReadinessChanged") {
				Vitest.assert.strictEqual(events[0].payload.status, "ready")
			}
		})
	)

	Vitest.it.effect("emits CheckpointReverted from checkpoint.revert", () =>
		Effect.gen(function*() {
			const events = yield* decide(
				checkpointReadModel,
				CheckpointRevertCommand.make({
					type: "checkpoint.revert",
					commandId,
					sessionId,
					checkpointId,
					projectPath: null,
					worktreePath: null
				}),
				identity
			)
			Vitest.assert.strictEqual(events[0]?.type, "CheckpointReverted")
			if (events[0]?.type === "CheckpointReverted") {
				Vitest.assert.strictEqual(events[0].payload.checkpointId, checkpointId)
			}
		})
	)

	Vitest.it.effect("rejects checkpoint.revert when the checkpoint is missing", () =>
		Effect.gen(function*() {
			const error = yield* Effect.flip(
				decide(
					sessionReadModel,
					CheckpointRevertCommand.make({
						type: "checkpoint.revert",
						commandId,
						sessionId,
						checkpointId,
						projectPath: null,
						worktreePath: null
					}),
					identity
				)
			)
			Vitest.assert.strictEqual(error._tag, "OrchestrationCommandInvariantError")
			Vitest.assert.strictEqual(
				error.detail,
				"Checkpoint 'checkpoint-1' does not exist on session 'session-1' for command 'checkpoint.revert'."
			)
		})
	)

	Vitest.it.effect("rejects checkpoint.create when the checkpoint id already exists", () =>
		Effect.gen(function*() {
			const error = yield* Effect.flip(
				decide(
					checkpointReadModel,
					CheckpointCreateCommand.make({
						type: "checkpoint.create",
						commandId,
						sessionId,
						checkpointId,
						checkpointNumber: 1,
						name: "After edit",
						isAuto: true,
						toolCallId,
						fileCount: 2,
						projectPath: null,
						worktreePath: null,
						modifiedFiles: []
					}),
					identity
				)
			)
			Vitest.assert.strictEqual(error._tag, "OrchestrationCommandInvariantError")
			Vitest.assert.strictEqual(
				error.detail,
				"Checkpoint 'checkpoint-1' already exists on session 'session-1' and cannot be created twice."
			)
		})
	)

	Vitest.it.effect("emits SettingsUpdated without a project or session", () =>
		Effect.gen(function*() {
			const events = yield* decide(
				emptyReadModel,
				SettingsSetCommand.make({
					type: "settings.set",
					commandId,
					key: "ui_font_size",
					value: "14"
				}),
				identity
			)
			Vitest.assert.deepStrictEqual(events, [
				{
					sequence: 1,
					eventId,
					aggregateKind: "settings",
					aggregateId: APP_SETTINGS_ID,
					occurredAt,
					commandId,
					causationEventId: null,
					correlationId: commandId,
					metadata: {},
					type: "SettingsUpdated",
					payload: {
						key: "ui_font_size",
						value: "14"
					}
				}
			])
		})
	)

	Vitest.it.effect("emits SkillsDiscovered without a project or session", () =>
		Effect.gen(function*() {
			const events = yield* decide(
				emptyReadModel,
				SkillsDiscoverCommand.make({
					type: "skills.discover",
					commandId,
					catalog: emptySkillsCatalog
				}),
				identity
			)
			Vitest.assert.deepStrictEqual(events, [
				{
					sequence: 1,
					eventId,
					aggregateKind: "skills",
					aggregateId: APP_SKILLS_ID,
					occurredAt,
					commandId,
					causationEventId: null,
					correlationId: commandId,
					metadata: {},
					type: "SkillsDiscovered",
					payload: emptySkillsCatalog
				}
			])
		})
	)

	Vitest.it.effect("emits VoiceModelsListed without a project or session", () =>
		Effect.gen(function*() {
			const events = yield* decide(
				emptyReadModel,
				VoiceModelsListCommand.make({
					type: "voice.models.list",
					commandId,
					models: emptyVoiceModels
				}),
				identity
			)
			Vitest.assert.deepStrictEqual(events, [
				{
					sequence: 1,
					eventId,
					aggregateKind: "voice",
					aggregateId: APP_VOICE_ID,
					occurredAt,
					commandId,
					causationEventId: null,
					correlationId: commandId,
					metadata: {},
					type: "VoiceModelsListed",
					payload: {
						models: emptyVoiceModels
					}
				}
			])
		})
	)

	Vitest.it.effect("emits SessionReviewFileMarked from the command fields", () =>
		Effect.gen(function*() {
			const events = yield* decide(
				sessionReadModel,
				ReviewFileMarkReviewedCommand.make({
					type: "review.file.markReviewed",
					commandId,
					sessionId,
					revisionKey: "src/index.ts:abc123",
					filePath: "src/index.ts",
					reviewed: true
				}),
				identity
			)
			Vitest.assert.deepStrictEqual(events, [
				{
					sequence: 3,
					eventId,
					aggregateKind: "session",
					aggregateId: sessionId,
					occurredAt,
					commandId,
					causationEventId: null,
					correlationId: commandId,
					metadata: {},
					type: "SessionReviewFileMarked",
					payload: {
						sessionId,
						revisionKey: "src/index.ts:abc123",
						filePath: "src/index.ts",
						reviewed: true
					}
				}
			])
		})
	)

	Vitest.it.effect("rejects review.file.markReviewed when the session does not exist", () =>
		Effect.gen(function*() {
			const error = yield* Effect.flip(
				decide(
					emptyReadModel,
					ReviewFileMarkReviewedCommand.make({
						type: "review.file.markReviewed",
						commandId,
						sessionId,
						revisionKey: "src/index.ts:abc123",
						filePath: "src/index.ts",
						reviewed: true
					}),
					identity
				)
			)
			Vitest.assert.strictEqual(error._tag, "OrchestrationCommandInvariantError")
			Vitest.assert.strictEqual(
				error.detail,
				"Session 'session-1' does not exist for command 'review.file.markReviewed'."
			)
		})
	)

	Vitest.it.effect("rejects review.file.markReviewed when the session is archived", () =>
		Effect.gen(function*() {
			const error = yield* Effect.flip(
				decide(
					archivedSessionReadModel,
					ReviewFileMarkReviewedCommand.make({
						type: "review.file.markReviewed",
						commandId,
						sessionId,
						revisionKey: "src/index.ts:abc123",
						filePath: "src/index.ts",
						reviewed: true
					}),
					identity
				)
			)
			Vitest.assert.strictEqual(error._tag, "OrchestrationCommandInvariantError")
			Vitest.assert.strictEqual(
				error.detail,
				"Session 'session-1' is already archived and cannot handle command 'review.file.markReviewed'."
			)
		})
	)

	Vitest.it.effect("emits SessionReviewStateCleared from the command fields", () =>
		Effect.gen(function*() {
			const events = yield* decide(
				sessionReadModel,
				ReviewSessionClearCommand.make({
					type: "review.session.clear",
					commandId,
					sessionId
				}),
				identity
			)
			Vitest.assert.deepStrictEqual(events, [
				{
					sequence: 3,
					eventId,
					aggregateKind: "session",
					aggregateId: sessionId,
					occurredAt,
					commandId,
					causationEventId: null,
					correlationId: commandId,
					metadata: {},
					type: "SessionReviewStateCleared",
					payload: { sessionId }
				}
			])
		})
	)

	Vitest.it.effect("rejects review.session.clear when the session does not exist", () =>
		Effect.gen(function*() {
			const error = yield* Effect.flip(
				decide(
					emptyReadModel,
					ReviewSessionClearCommand.make({
						type: "review.session.clear",
						commandId,
						sessionId
					}),
					identity
				)
			)
			Vitest.assert.strictEqual(error._tag, "OrchestrationCommandInvariantError")
			Vitest.assert.strictEqual(
				error.detail,
				"Session 'session-1' does not exist for command 'review.session.clear'."
			)
		})
	)

	Vitest.it.effect("rejects review.session.clear when the session is archived", () =>
		Effect.gen(function*() {
			const error = yield* Effect.flip(
				decide(
					archivedSessionReadModel,
					ReviewSessionClearCommand.make({
						type: "review.session.clear",
						commandId,
						sessionId
					}),
					identity
				)
			)
			Vitest.assert.strictEqual(error._tag, "OrchestrationCommandInvariantError")
			Vitest.assert.strictEqual(
				error.detail,
				"Session 'session-1' is already archived and cannot handle command 'review.session.clear'."
			)
		})
	)
})
