import {
	APP_SKILLS_ID,
	CommandId,
	emptySkillsCatalog,
	EventId,
	type OrchestrationEvent,
	ProjectId
} from "@acepe/contracts"
import * as Vitest from "@effect/vitest"
import * as Effect from "effect/Effect"
import * as Option from "effect/Option"
import { evolveProjectedSkillsCatalog } from "./ProjectionSkills.ts"

const NOW = "2026-08-20T12:00:00.000Z"
const commandId = CommandId.make("cmd-1")
const projectId = ProjectId.make("project-1")

const skillsDiscovered = (sequence: number): OrchestrationEvent => ({
	sequence,
	eventId: EventId.make(`event-${sequence}`),
	aggregateKind: "skills",
	aggregateId: APP_SKILLS_ID,
	occurredAt: NOW,
	commandId,
	causationEventId: null,
	correlationId: commandId,
	metadata: {},
	type: "SkillsDiscovered",
	payload: emptySkillsCatalog
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

Vitest.describe("evolveProjectedSkillsCatalog", () => {
	Vitest.it.effect("projects SkillsDiscovered as a catalog", () =>
		Effect.gen(function*() {
			const next = yield* evolveProjectedSkillsCatalog(Option.none(), skillsDiscovered(2))
			Vitest.assert.deepStrictEqual(
				next,
				Option.some({
					sequence: 2,
					agents: [],
					agentSkills: [],
					plugins: [],
					pluginSkills: [],
					tree: []
				})
			)
		})
	)

	Vitest.it.effect("replaces the catalog on a later SkillsDiscovered", () =>
		Effect.gen(function*() {
			const first = yield* evolveProjectedSkillsCatalog(Option.none(), skillsDiscovered(2))
			const next = yield* evolveProjectedSkillsCatalog(first, skillsDiscovered(5))
			Vitest.assert.deepStrictEqual(
				next,
				Option.some({
					sequence: 5,
					agents: [],
					agentSkills: [],
					plugins: [],
					pluginSkills: [],
					tree: []
				})
			)
		})
	)

	Vitest.it.effect("ignores project events", () =>
		Effect.gen(function*() {
			const next = yield* evolveProjectedSkillsCatalog(Option.none(), projectCreated)
			Vitest.assert.deepStrictEqual(next, Option.none())
		})
	)
})
