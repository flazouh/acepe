import {
	CheckpointCreateCommand,
	CheckpointId,
	CheckpointRevertCommand,
	CommandId,
	type OrchestrationCommand,
	emptySkillsCatalog,
	ProjectId,
	ProjectMetaUpdateCommand,
	SessionArchiveCommand,
	SessionCreateCommand,
	SessionId,
	SkillsDiscoverCommand
} from "@acepe/contracts"
import * as Vitest from "@effect/vitest"
import * as Effect from "effect/Effect"
import {
	type OrchestrationReadModel,
	requireProject,
	requireProjectAbsent,
	requireSession,
	requireSessionAbsent,
	requireSessionArchived,
	requireSessionNotArchived,
	requireUniqueSkillIds,
	requireCheckpoint,
	requireCheckpointAbsent
} from "./commandInvariants.ts"

const occurredAt = "2026-08-20T12:00:00.000Z"
const commandId = CommandId.make("cmd-1")
const projectId = ProjectId.make("project-1")
const missingProjectId = ProjectId.make("project-missing")
const sessionId = SessionId.make("session-1")
const missingSessionId = SessionId.make("session-missing")
const archivedSessionId = SessionId.make("session-archived")
const checkpointId = CheckpointId.make("checkpoint-1")

const emptyReadModel: OrchestrationReadModel = {
	snapshotSequence: 0,
	projects: [],
	sessions: []
}

const populatedReadModel: OrchestrationReadModel = {
	snapshotSequence: 4,
	projects: [{ id: projectId }],
	sessions: [
		{
			id: sessionId,
			projectId,
			archivedAt: null,
			checkpoints: []
		},
		{
			id: archivedSessionId,
			projectId,
			archivedAt: occurredAt,
			checkpoints: []
		}
	]
}

const projectMetaCommand: OrchestrationCommand = ProjectMetaUpdateCommand.make({
	type: "project.meta.update",
	commandId,
	projectId,
	title: "Acepe Desktop"
})

const sessionCreateCommand: OrchestrationCommand = SessionCreateCommand.make({
	type: "session.create",
	commandId,
	sessionId,
	projectId,
	title: "First session"
})

const sessionArchiveCommand: OrchestrationCommand = SessionArchiveCommand.make({
	type: "session.archive",
	commandId,
	sessionId
})

const checkpointRevertCommand = CheckpointRevertCommand.make({
	type: "checkpoint.revert",
	commandId,
	sessionId,
	checkpointId
})

const checkpointCreateCommand = CheckpointCreateCommand.make({
	type: "checkpoint.create",
	commandId,
	sessionId,
	checkpointId,
	checkpointNumber: 1,
	name: "After edit",
	isAuto: false,
	toolCallId: null,
	fileCount: 1
})

Vitest.describe("requireProject", () => {
	Vitest.it.effect("returns the project when it exists", () =>
		Effect.gen(function*() {
			const project = yield* requireProject({
				readModel: populatedReadModel,
				command: projectMetaCommand,
				projectId
			})
			Vitest.assert.strictEqual(project.id, projectId)
		})
	)

	Vitest.it.effect("fails when the project is missing", () =>
		Effect.gen(function*() {
			const error = yield* Effect.flip(
				requireProject({
					readModel: emptyReadModel,
					command: projectMetaCommand,
					projectId: missingProjectId
				})
			)
			Vitest.assert.strictEqual(error._tag, "OrchestrationCommandInvariantError")
			Vitest.assert.strictEqual(error.commandType, "project.meta.update")
			Vitest.assert.strictEqual(
				error.detail,
				"Project 'project-missing' does not exist for command 'project.meta.update'."
			)
		})
	)
})

Vitest.describe("requireProjectAbsent", () => {
	Vitest.it.effect("succeeds when the project is missing", () =>
		requireProjectAbsent({
			readModel: emptyReadModel,
			command: projectMetaCommand,
			projectId
		})
	)

	Vitest.it.effect("fails when the project already exists", () =>
		Effect.gen(function*() {
			const error = yield* Effect.flip(
				requireProjectAbsent({
					readModel: populatedReadModel,
					command: projectMetaCommand,
					projectId
				})
			)
			Vitest.assert.strictEqual(error._tag, "OrchestrationCommandInvariantError")
			Vitest.assert.strictEqual(
				error.detail,
				"Project 'project-1' already exists and cannot be created twice."
			)
		})
	)
})

Vitest.describe("requireSession", () => {
	Vitest.it.effect("returns the session when it exists", () =>
		Effect.gen(function*() {
			const session = yield* requireSession({
				readModel: populatedReadModel,
				command: sessionArchiveCommand,
				sessionId
			})
			Vitest.assert.strictEqual(session.id, sessionId)
			Vitest.assert.strictEqual(session.archivedAt, null)
		})
	)

	Vitest.it.effect("fails when the session is missing", () =>
		Effect.gen(function*() {
			const error = yield* Effect.flip(
				requireSession({
					readModel: emptyReadModel,
					command: sessionArchiveCommand,
					sessionId: missingSessionId
				})
			)
			Vitest.assert.strictEqual(error._tag, "OrchestrationCommandInvariantError")
			Vitest.assert.strictEqual(error.commandType, "session.archive")
			Vitest.assert.strictEqual(
				error.detail,
				"Session 'session-missing' does not exist for command 'session.archive'."
			)
		})
	)
})

Vitest.describe("requireSessionAbsent", () => {
	Vitest.it.effect("succeeds when the session is missing", () =>
		requireSessionAbsent({
			readModel: emptyReadModel,
			command: sessionCreateCommand,
			sessionId
		})
	)

	Vitest.it.effect("fails when the session already exists", () =>
		Effect.gen(function*() {
			const error = yield* Effect.flip(
				requireSessionAbsent({
					readModel: populatedReadModel,
					command: sessionCreateCommand,
					sessionId
				})
			)
			Vitest.assert.strictEqual(error._tag, "OrchestrationCommandInvariantError")
			Vitest.assert.strictEqual(
				error.detail,
				"Session 'session-1' already exists and cannot be created twice."
			)
		})
	)
})

Vitest.describe("requireSessionNotArchived", () => {
	Vitest.it.effect("returns the session when it is present and not archived", () =>
		Effect.gen(function*() {
			const session = yield* requireSessionNotArchived({
				readModel: populatedReadModel,
				command: sessionArchiveCommand,
				sessionId
			})
			Vitest.assert.strictEqual(session.id, sessionId)
		})
	)

	Vitest.it.effect("fails when the session is archived", () =>
		Effect.gen(function*() {
			const error = yield* Effect.flip(
				requireSessionNotArchived({
					readModel: populatedReadModel,
					command: sessionArchiveCommand,
					sessionId: archivedSessionId
				})
			)
			Vitest.assert.strictEqual(error._tag, "OrchestrationCommandInvariantError")
			Vitest.assert.strictEqual(
				error.detail,
				"Session 'session-archived' is already archived and cannot handle command 'session.archive'."
			)
		})
	)
})

Vitest.describe("requireSessionArchived", () => {
	Vitest.it.effect("returns the session when it is archived", () =>
		Effect.gen(function*() {
			const session = yield* requireSessionArchived({
				readModel: populatedReadModel,
				command: sessionArchiveCommand,
				sessionId: archivedSessionId
			})
			Vitest.assert.strictEqual(session.id, archivedSessionId)
			Vitest.assert.strictEqual(session.archivedAt, occurredAt)
		})
	)

	Vitest.it.effect("fails when the session is not archived", () =>
		Effect.gen(function*() {
			const error = yield* Effect.flip(
				requireSessionArchived({
					readModel: populatedReadModel,
					command: sessionArchiveCommand,
					sessionId
				})
			)
			Vitest.assert.strictEqual(error._tag, "OrchestrationCommandInvariantError")
			Vitest.assert.strictEqual(
				error.detail,
				"Session 'session-1' is not archived for command 'session.archive'."
			)
		})
	)
})

Vitest.describe("requireCheckpoint", () => {
	Vitest.it.effect("fails when the checkpoint is missing", () =>
		Effect.gen(function*() {
			const error = yield* Effect.flip(
				requireCheckpoint({
					readModel: populatedReadModel,
					command: checkpointRevertCommand,
					sessionId,
					checkpointId
				})
			)
			Vitest.assert.strictEqual(error._tag, "OrchestrationCommandInvariantError")
			Vitest.assert.strictEqual(
				error.detail,
				"Checkpoint 'checkpoint-1' does not exist on session 'session-1' for command 'checkpoint.revert'."
			)
		})
	)

	Vitest.it.effect("returns the checkpoint when it exists", () =>
		Effect.gen(function*() {
			const checkpoint = yield* requireCheckpoint({
				readModel: {
					snapshotSequence: 5,
					projects: [{ id: projectId }],
					sessions: [
						{
							id: sessionId,
							projectId,
							archivedAt: null,
							checkpoints: [{ id: checkpointId }]
						}
					]
				},
				command: checkpointRevertCommand,
				sessionId,
				checkpointId
			})
			Vitest.assert.strictEqual(checkpoint.id, checkpointId)
		})
	)
})

Vitest.describe("requireCheckpointAbsent", () => {
	Vitest.it.effect("succeeds when the checkpoint is missing", () =>
		requireCheckpointAbsent({
			readModel: populatedReadModel,
			command: checkpointCreateCommand,
			sessionId,
			checkpointId
		})
	)

	Vitest.it.effect("fails when the checkpoint already exists", () =>
		Effect.gen(function*() {
			const error = yield* Effect.flip(
				requireCheckpointAbsent({
					readModel: {
						snapshotSequence: 5,
						projects: [{ id: projectId }],
						sessions: [
							{
								id: sessionId,
								projectId,
								archivedAt: null,
								checkpoints: [{ id: checkpointId }]
							}
						]
					},
					command: checkpointCreateCommand,
					sessionId,
					checkpointId
				})
			)
			Vitest.assert.strictEqual(error._tag, "OrchestrationCommandInvariantError")
			Vitest.assert.strictEqual(
				error.detail,
				"Checkpoint 'checkpoint-1' already exists on session 'session-1' and cannot be created twice."
			)
		})
	)
})


const emptyDiscover = SkillsDiscoverCommand.make({
	type: "skills.discover",
	commandId,
	catalog: emptySkillsCatalog
})

const duplicateSkill = {
	id: "claude-code::review",
	agentId: "claude-code" as const,
	folderName: "review",
	path: "/tmp/review/SKILL.md",
	name: "review",
	description: "",
	content: "body",
	modifiedAt: 0
}

Vitest.describe("requireUniqueSkillIds", () => {
	Vitest.it.effect("succeeds for an empty catalog", () => requireUniqueSkillIds(emptyDiscover))

	Vitest.it.effect("fails when two agent skills share an id", () =>
		Effect.gen(function*() {
			const error = yield* Effect.flip(
				requireUniqueSkillIds(
					SkillsDiscoverCommand.make({
						type: "skills.discover",
						commandId,
						catalog: {
							agents: [],
							agentSkills: [
								{
									agentId: "claude-code",
									skills: [duplicateSkill, duplicateSkill]
								}
							],
							plugins: [],
							pluginSkills: [],
							tree: []
						}
					})
				)
			)
			Vitest.assert.strictEqual(error._tag, "OrchestrationCommandInvariantError")
			Vitest.assert.strictEqual(
				error.detail,
				"Duplicate skill id 'claude-code::review' in skills.discover."
			)
		})
	)
})