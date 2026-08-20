import {
	CommandId,
	type OrchestrationCommand,
	ProjectId,
	ProjectMetaUpdateCommand,
	SessionArchiveCommand,
	SessionCreateCommand,
	SessionId
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
	requireSessionNotArchived
} from "./commandInvariants.ts"

const occurredAt = "2026-08-20T12:00:00.000Z"
const commandId = CommandId.make("cmd-1")
const projectId = ProjectId.make("project-1")
const missingProjectId = ProjectId.make("project-missing")
const sessionId = SessionId.make("session-1")
const missingSessionId = SessionId.make("session-missing")
const archivedSessionId = SessionId.make("session-archived")

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
			archivedAt: null
		},
		{
			id: archivedSessionId,
			projectId,
			archivedAt: occurredAt
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
