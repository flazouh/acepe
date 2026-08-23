import {
	CommandId,
	EventId,
	type OrchestrationEvent,
	ProjectId
} from "@acepe/contracts"
import * as Vitest from "@effect/vitest"
import * as Effect from "effect/Effect"
import * as Option from "effect/Option"
import {
	evolveProjectedGitReview,
	PROJECTION_GIT_NAME,
	ProjectionGit
} from "./ProjectionGit.ts"

const NOW = "2026-08-20T12:00:00.000Z"
const commandId = CommandId.make("cmd-1")
const projectId = ProjectId.make("project-1")

const statusRefreshed = (sequence: number): OrchestrationEvent => ({
	sequence,
	eventId: EventId.make(`event-${sequence}`),
	aggregateKind: "git",
	aggregateId: projectId,
	occurredAt: NOW,
	commandId,
	causationEventId: null,
	correlationId: commandId,
	metadata: {},
	type: "GitStatusRefreshed",
	payload: {
		projectId,
		status: [
			{
				path: "notes.md",
				status: "M",
				insertions: 2,
				deletions: 2
			}
		]
	}
})

const projectCreated: OrchestrationEvent = {
	sequence: 1,
	eventId: EventId.make("event-1"),
	aggregateKind: "project",
	aggregateId: projectId,
	occurredAt: NOW,
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

Vitest.describe("evolveProjectedGitReview", () => {
	Vitest.it.effect("projects GitStatusRefreshed onto a review row", () =>
		Effect.gen(function*() {
			const next = yield* evolveProjectedGitReview(Option.none(), statusRefreshed(2))
			Vitest.assert.deepStrictEqual(
				next,
				Option.some({
					sequence: 2,
					projectId,
					status: [
						{
							path: "notes.md",
							status: "M",
							insertions: 2,
							deletions: 2
						}
					],
					files: []
				})
			)
		})
	)

	Vitest.it.effect("ignores project events", () =>
		Effect.gen(function*() {
			const next = yield* evolveProjectedGitReview(Option.none(), projectCreated)
			Vitest.assert.deepStrictEqual(next, Option.none())
		})
	)
})

Vitest.describe("ProjectionGit", () => {
	Vitest.it("is a service class named projection.git", () => {
		Vitest.assert.strictEqual(ProjectionGit.key, "@acepe/server/persistence/Services/ProjectionGit")
		Vitest.assert.strictEqual(PROJECTION_GIT_NAME, "projection.git")
	})
})
