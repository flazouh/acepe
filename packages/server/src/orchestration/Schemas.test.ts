import {
	CheckpointId,
	MessageSentPayload as ContractsMessageSentPayload,
	ProjectCreatedPayload as ContractsProjectCreatedPayload
} from "@acepe/contracts"
import * as Vitest from "@effect/vitest"
import * as Arr from "effect/Array"
import * as Effect from "effect/Effect"
import * as Exit from "effect/Exit"
import * as Schema from "effect/Schema"
import {
	MAX_SESSION_CHECKPOINTS,
	MAX_SESSION_MESSAGES,
	MessageSentPayload,
	OrchestrationProject,
	OrchestrationProjectorDecodeError,
	OrchestrationReadModel,
	OrchestrationSession,
	OrchestrationSessionCheckpoint,
	OrchestrationSessionMessage,
	ProjectCreatedPayload
} from "./Schemas.ts"

const NOW = "2026-08-20T12:00:00.000Z"

Vitest.describe("payload schema aliases", () => {
	Vitest.it("reuses the contract payload schemas", () => {
		Vitest.assert.strictEqual(ProjectCreatedPayload, ContractsProjectCreatedPayload)
		Vitest.assert.strictEqual(MessageSentPayload, ContractsMessageSentPayload)
	})
})

Vitest.describe("retention constants", () => {
	Vitest.it("bounds per-session messages and checkpoints", () => {
		Vitest.assert.strictEqual(MAX_SESSION_MESSAGES, 2_000)
		Vitest.assert.strictEqual(MAX_SESSION_CHECKPOINTS, 500)
	})
})

Vitest.describe("OrchestrationReadModel", () => {
	Vitest.it("decodes the zero snapshot", () => {
		const decoded = Effect.runSync(
			Schema.decodeUnknownEffect(OrchestrationReadModel)({
				snapshotSequence: 0,
				projects: [],
				sessions: [],
				updatedAt: NOW
			})
		)
		Vitest.assert.deepStrictEqual(decoded, {
			snapshotSequence: 0,
			projects: [],
			sessions: [],
			updatedAt: NOW
		})
	})

	Vitest.it("rejects a session that exceeds the message bound", () => {
		const messages = Arr.makeBy(MAX_SESSION_MESSAGES + 1, (index) => ({
			id: `message-${index}`,
			text: "hello",
			createdAt: NOW
		}))
		const exit = Effect.runSyncExit(
			Schema.decodeUnknownEffect(OrchestrationSession)({
				id: "session-1",
				projectId: "project-1",
				title: "First session",
				createdAt: NOW,
				updatedAt: NOW,
				archivedAt: null,
				deletedAt: null,
				messages,
				checkpoints: []
			})
		)
		Vitest.assert.isTrue(Exit.isFailure(exit))
	})

	Vitest.it("rejects a session that exceeds the checkpoint bound", () => {
		const checkpoints = Arr.makeBy(MAX_SESSION_CHECKPOINTS + 1, (index) => ({
			id: CheckpointId.make(`checkpoint-${index}`),
			createdAt: NOW
		}))
		const exit = Effect.runSyncExit(
			Schema.decodeUnknownEffect(OrchestrationSession)({
				id: "session-1",
				projectId: "project-1",
				title: "First session",
				createdAt: NOW,
				updatedAt: NOW,
				archivedAt: null,
				deletedAt: null,
				messages: [],
				checkpoints
			})
		)
		Vitest.assert.isTrue(Exit.isFailure(exit))
	})

	Vitest.it("decodes a project, message, and checkpoint", () => {
		const project = Effect.runSync(
			Schema.decodeUnknownEffect(OrchestrationProject)({
				id: "project-1",
				title: "Acepe",
				workspaceRoot: "/tmp/acepe",
				createdAt: NOW,
				updatedAt: NOW,
				deletedAt: null
			})
		)
		const message = Effect.runSync(
			Schema.decodeUnknownEffect(OrchestrationSessionMessage)({
				id: "message-1",
				text: "Ship the lifecycle slice",
				createdAt: NOW
			})
		)
		const checkpoint = Effect.runSync(
			Schema.decodeUnknownEffect(OrchestrationSessionCheckpoint)({
				id: "checkpoint-1",
				createdAt: NOW
			})
		)
		Vitest.assert.strictEqual(project.title, "Acepe")
		Vitest.assert.strictEqual(message.text, "Ship the lifecycle slice")
		Vitest.assert.strictEqual(checkpoint.id, "checkpoint-1")
	})
})

Vitest.describe("OrchestrationProjectorDecodeError", () => {
	Vitest.it("is a tagged yieldable error", () => {
		const error = new OrchestrationProjectorDecodeError({
			eventType: "ProjectCreated",
			field: "payload",
			issue: "missing title"
		})
		Vitest.assert.strictEqual(error._tag, "OrchestrationProjectorDecodeError")
		Vitest.assert.strictEqual(error.eventType, "ProjectCreated")
		Vitest.assert.strictEqual(error.field, "payload")
		Vitest.assert.strictEqual(error.issue, "missing title")
	})
})
