import {
	CommandId,
	EventId,
	GitStatusRefreshCommand,
	ProjectCreateCommand,
	ProjectId
} from "@acepe/contracts"
import * as Vitest from "@effect/vitest"
import * as Effect from "effect/Effect"
import type { OrchestrationReadModel } from "./commandInvariants.ts"
import { decideGit } from "./gitDecide.ts"

const occurredAt = "2026-08-20T12:00:00.000Z"
const commandId = CommandId.make("cmd-git")
const eventId = EventId.make("event-git")
const projectId = ProjectId.make("project-1")
const identity = {
	eventId,
	occurredAt
}

const emptyReadModel: OrchestrationReadModel = {
	snapshotSequence: 0,
	projects: [],
	sessions: []
}

const withProject: OrchestrationReadModel = {
	snapshotSequence: 3,
	projects: [
		{
			id: projectId
		}
	],
	sessions: []
}

Vitest.describe("decideGit", () => {
	Vitest.it.effect("rejects git commands when the project is missing", () =>
		Effect.gen(function*() {
			const error = yield* Effect.flip(
				decideGit(
					emptyReadModel,
					GitStatusRefreshCommand.make({
						type: "git.status.refresh",
						commandId,
						projectId,
						workspaceRoot: "/tmp/acepe",
						status: null
					}),
					identity
				)
			)
			Vitest.assert.strictEqual(error._tag, "OrchestrationCommandInvariantError")
			Vitest.assert.strictEqual(error.commandType, "git.status.refresh")
		})
	)

	Vitest.it.effect("emits GitStatusRefreshed for git.status.refresh", () =>
		Effect.gen(function*() {
			const events = yield* decideGit(
				withProject,
				GitStatusRefreshCommand.make({
					type: "git.status.refresh",
					commandId,
					projectId,
					workspaceRoot: "/tmp/acepe-git-review-242",
					status: [
						{
							path: "notes.md",
							status: "M",
							insertions: 2,
							deletions: 2
						}
					]
				}),
				identity
			)
			Vitest.assert.strictEqual(events[0]?.type, "GitStatusRefreshed")
			Vitest.assert.strictEqual(events[0]?.aggregateKind, "git")
			Vitest.assert.strictEqual(events[0]?.aggregateId, projectId)
			Vitest.assert.strictEqual(events[0]?.sequence, 4)
		})
	)
})
