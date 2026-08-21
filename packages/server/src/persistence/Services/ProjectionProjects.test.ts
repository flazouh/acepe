import {
	CommandId,
	EventId,
	MessageId,
	type OrchestrationEvent,
	ProjectId,
	SessionId
} from "@acepe/contracts"
import * as Vitest from "@effect/vitest"
import * as Effect from "effect/Effect"
import * as HashMap from "effect/HashMap"
import * as Option from "effect/Option"
import {
	emptyProjectedProjectsState,
	evolveProjectedProjects,
	isScanWarmed,
	PROJECTION_PROJECTS_NAME,
	type ProjectedProject,
	type ProjectedProjectsState,
	ProjectionProjects
} from "./ProjectionProjects.ts"

const NOW = "2026-08-20T12:00:00.000Z"
const LATER = "2026-08-20T12:00:01.000Z"
const END = "2026-08-20T12:00:02.000Z"
const commandId = CommandId.make("cmd-1")
const projectId = ProjectId.make("project-1")
const otherProjectId = ProjectId.make("project-2")
const sessionId = SessionId.make("session-1")
const sessionTwoId = SessionId.make("session-2")
const messageId = MessageId.make("message-1")

type ProjectEventType = Extract<
	OrchestrationEvent["type"],
	"ProjectCreated" | "ProjectMetaUpdated" | "ProjectDeleted"
>

type SessionEventType = Extract<
	OrchestrationEvent["type"],
	| "SessionCreated"
	| "SessionMetaUpdated"
	| "SessionArchived"
	| "SessionUnarchived"
	| "SessionDeleted"
	| "MessageSent"
	| "TurnCancelled"
>

const projectEvent = <const Type extends ProjectEventType, Payload>(
	sequence: number,
	type: Type,
	occurredAt: string,
	payload: Payload,
	aggregateId: ProjectId = projectId
) => ({
	sequence,
	eventId: EventId.make(`event-${sequence}`),
	aggregateKind: "project" as const,
	aggregateId,
	occurredAt,
	commandId,
	causationEventId: null,
	correlationId: commandId,
	metadata: {},
	type,
	payload
})

const sessionEvent = <const Type extends SessionEventType, Payload>(
	sequence: number,
	type: Type,
	occurredAt: string,
	payload: Payload,
	aggregateId: SessionId = sessionId
) => ({
	sequence,
	eventId: EventId.make(`event-${sequence}`),
	aggregateKind: "session" as const,
	aggregateId,
	occurredAt,
	commandId,
	causationEventId: null,
	correlationId: commandId,
	metadata: {},
	type,
	payload
})

const fold = (events: ReadonlyArray<OrchestrationEvent>) =>
	Effect.reduce(events, emptyProjectedProjectsState, evolveProjectedProjects)

const requireProject = (state: ProjectedProjectsState, id: ProjectId): ProjectedProject => {
	const found = HashMap.get(state.projects, id)
	return Option.match(found, {
		onNone: () => {
			Vitest.assert.fail(`expected project ${id}`)
			return undefined as never
		},
		onSome: (project) => project
	})
}

Vitest.describe("ProjectionProjects", () => {
	Vitest.it("is a service class named projection.projects", () => {
		Vitest.assert.strictEqual(
			ProjectionProjects.key,
			"@acepe/server/persistence/Services/ProjectionProjects"
		)
		Vitest.assert.strictEqual(PROJECTION_PROJECTS_NAME, "projection.projects")
	})
})

Vitest.describe("evolveProjectedProjects", () => {
	Vitest.it.effect("materialises a project with repository metadata and a warmed scan", () =>
		Effect.gen(function*() {
			const state = yield* fold([
				projectEvent(1, "ProjectCreated", NOW, {
					projectId,
					title: "Acepe",
					workspaceRoot: "/tmp/acepe"
				})
			])
			const project = requireProject(state, projectId)
			Vitest.assert.deepStrictEqual(project, {
				projectId,
				title: "Acepe",
				workspaceRoot: "/tmp/acepe",
				createdAt: NOW,
				updatedAt: NOW,
				deletedAt: null,
				sessionCount: 0,
				scanWarmedAt: NOW
			})
			Vitest.assert.isTrue(isScanWarmed(project))
		})
	)

	Vitest.it.effect("updates title and workspace root from ProjectMetaUpdated", () =>
		Effect.gen(function*() {
			const state = yield* fold([
				projectEvent(1, "ProjectCreated", NOW, {
					projectId,
					title: "Acepe",
					workspaceRoot: "/tmp/acepe"
				}),
				projectEvent(2, "ProjectMetaUpdated", LATER, {
					projectId,
					title: "Acepe Desktop",
					workspaceRoot: "/tmp/acepe-desktop"
				})
			])
			const project = requireProject(state, projectId)
			Vitest.assert.strictEqual(project.title, "Acepe Desktop")
			Vitest.assert.strictEqual(project.workspaceRoot, "/tmp/acepe-desktop")
			Vitest.assert.strictEqual(project.updatedAt, LATER)
			Vitest.assert.strictEqual(project.scanWarmedAt, NOW)
			Vitest.assert.strictEqual(project.sessionCount, 0)
		})
	)

	Vitest.it.effect("keeps a deleted project row instead of dropping it", () =>
		Effect.gen(function*() {
			const state = yield* fold([
				projectEvent(1, "ProjectCreated", NOW, {
					projectId,
					title: "Acepe",
					workspaceRoot: "/tmp/acepe"
				}),
				projectEvent(2, "ProjectDeleted", LATER, {
					projectId
				})
			])
			const project = requireProject(state, projectId)
			Vitest.assert.strictEqual(project.deletedAt, LATER)
			Vitest.assert.strictEqual(HashMap.size(state.projects), 1)
		})
	)

	Vitest.it.effect("maintains session counts on SessionCreated and SessionDeleted", () =>
		Effect.gen(function*() {
			const state = yield* fold([
				projectEvent(1, "ProjectCreated", NOW, {
					projectId,
					title: "Acepe",
					workspaceRoot: "/tmp/acepe"
				}),
				sessionEvent(2, "SessionCreated", NOW, {
					sessionId,
					projectId,
					title: "First session"
				}),
				sessionEvent(
					3,
					"SessionCreated",
					NOW,
					{
						sessionId: sessionTwoId,
						projectId,
						title: "Second session"
					},
					sessionTwoId
				),
				sessionEvent(4, "SessionArchived", LATER, {
					sessionId
				}),
				sessionEvent(
					5,
					"SessionDeleted",
					END,
					{
						sessionId: sessionTwoId
					},
					sessionTwoId
				)
			])
			const project = requireProject(state, projectId)
			Vitest.assert.strictEqual(project.sessionCount, 1)
		})
	)

	Vitest.it.effect("does not double-count a duplicate SessionCreated", () =>
		Effect.gen(function*() {
			const state = yield* fold([
				projectEvent(1, "ProjectCreated", NOW, {
					projectId,
					title: "Acepe",
					workspaceRoot: "/tmp/acepe"
				}),
				sessionEvent(2, "SessionCreated", NOW, {
					sessionId,
					projectId,
					title: "First session"
				}),
				sessionEvent(3, "SessionCreated", LATER, {
					sessionId,
					projectId,
					title: "First session again"
				})
			])
			const project = requireProject(state, projectId)
			Vitest.assert.strictEqual(project.sessionCount, 1)
		})
	)

	Vitest.it.effect("counts sessions that arrive before ProjectCreated", () =>
		Effect.gen(function*() {
			const state = yield* fold([
				sessionEvent(1, "SessionCreated", NOW, {
					sessionId,
					projectId,
					title: "First session"
				}),
				projectEvent(2, "ProjectCreated", LATER, {
					projectId,
					title: "Acepe",
					workspaceRoot: "/tmp/acepe"
				})
			])
			const project = requireProject(state, projectId)
			Vitest.assert.strictEqual(project.sessionCount, 1)
			Vitest.assert.strictEqual(project.scanWarmedAt, LATER)
		})
	)

	Vitest.it.effect("keeps a duplicate ProjectCreated from resetting sessionCount", () =>
		Effect.gen(function*() {
			const state = yield* fold([
				projectEvent(1, "ProjectCreated", NOW, {
					projectId,
					title: "Acepe",
					workspaceRoot: "/tmp/acepe"
				}),
				sessionEvent(2, "SessionCreated", NOW, {
					sessionId,
					projectId,
					title: "First session"
				}),
				projectEvent(3, "ProjectCreated", LATER, {
					projectId,
					title: "Acepe",
					workspaceRoot: "/tmp/acepe"
				})
			])
			const project = requireProject(state, projectId)
			Vitest.assert.strictEqual(project.sessionCount, 1)
			Vitest.assert.strictEqual(project.scanWarmedAt, LATER)
		})
	)

	Vitest.it.effect("ignores sessions that belong to another project", () =>
		Effect.gen(function*() {
			const state = yield* fold([
				projectEvent(1, "ProjectCreated", NOW, {
					projectId,
					title: "Acepe",
					workspaceRoot: "/tmp/acepe"
				}),
				projectEvent(
					2,
					"ProjectCreated",
					NOW,
					{
						projectId: otherProjectId,
						title: "Other",
						workspaceRoot: "/tmp/other"
					},
					otherProjectId
				),
				sessionEvent(3, "SessionCreated", NOW, {
					sessionId,
					projectId: otherProjectId,
					title: "Other session"
				})
			])
			Vitest.assert.strictEqual(requireProject(state, projectId).sessionCount, 0)
			Vitest.assert.strictEqual(requireProject(state, otherProjectId).sessionCount, 1)
		})
	)

	Vitest.it.effect("ignores message events", () =>
		Effect.gen(function*() {
			const state = yield* fold([
				projectEvent(1, "ProjectCreated", NOW, {
					projectId,
					title: "Acepe",
					workspaceRoot: "/tmp/acepe"
				}),
				sessionEvent(2, "MessageSent", LATER, {
					sessionId,
					messageId,
					text: "Ping"
				})
			])
			Vitest.assert.strictEqual(requireProject(state, projectId).sessionCount, 0)
		})
	)
})
