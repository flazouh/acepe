import { ProjectId } from "@acepe/contracts"
import * as Vitest from "@effect/vitest"
import * as Effect from "effect/Effect"
import * as Option from "effect/Option"
import type { DiscoveredProject, DiscoveredSession } from "../history/discovery/Types.ts"
import type { ProviderSessionDiscoveryShape } from "../history/discovery/ProviderSessionDiscovery.ts"
import type {
	ProjectedProject,
	ProjectionProjectsShape
} from "../persistence/Services/ProjectionProjects.ts"
import { listProviderSessionsHandler } from "./handlers.ts"

const NOW = "2026-08-29T10:00:00.000Z"
const PROJECT_PATH = "/Users/example/acme"

const session = (id: string, origin: "acepe" | "external"): DiscoveredSession => ({
	id,
	title: `Session ${id}`,
	provider: "claude",
	projectPath: PROJECT_PATH,
	createdAtMs: 1,
	updatedAtMs: 2,
	sourcePath: `/tmp/${id}.jsonl`,
	origin
})

const DISCOVERED: ReadonlyArray<DiscoveredSession> = [
	session("started-by-acepe", "acepe"),
	session("written-by-another-terminal", "external")
]

const discoveryStub: ProviderSessionDiscoveryShape = {
	listSessionsForProject: () => Effect.succeed(DISCOVERED),
	listProjects: () => Effect.succeed<ReadonlyArray<DiscoveredProject>>([])
}

const project = (showExternalCliSessions: boolean): ProjectedProject => ({
	projectId: ProjectId.make("project-acme"),
	title: "Acme",
	workspaceRoot: PROJECT_PATH,
	createdAt: NOW,
	updatedAt: NOW,
	deletedAt: null,
	sessionCount: 2,
	color: "cyan",
	showExternalCliSessions,
	scanWarmedAt: NOW
})

const projectsStub = (rows: ReadonlyArray<ProjectedProject>): ProjectionProjectsShape => ({
	name: "projection.projects",
	apply: () => Effect.void,
	truncate: () => Effect.void,
	list: () => Effect.succeed(rows),
	get: () => Effect.succeed(Option.none())
})

const idsFrom = (sessions: ReadonlyArray<DiscoveredSession>): ReadonlyArray<string> =>
	sessions.map((entry) => entry.id)

Vitest.describe("listProviderSessions", () => {
	Vitest.it.effect("drops an external session and keeps the one Acepe started", () =>
		Effect.gen(function*() {
			const sessions = yield* listProviderSessionsHandler(
				discoveryStub,
				projectsStub([project(false)]),
				{ projectPath: PROJECT_PATH }
			)
			Vitest.assert.deepStrictEqual(idsFrom(sessions), ["started-by-acepe"])
		}))

	Vitest.it.effect("keeps every session once the project opts back in", () =>
		Effect.gen(function*() {
			const sessions = yield* listProviderSessionsHandler(
				discoveryStub,
				projectsStub([project(true)]),
				{ projectPath: PROJECT_PATH }
			)
			Vitest.assert.deepStrictEqual(idsFrom(sessions), [
				"started-by-acepe",
				"written-by-another-terminal"
			])
		}))

	// Discovery works on any path on disk, registered with Acepe or not.
	Vitest.it.effect("hides external sessions for a project the projection never saw", () =>
		Effect.gen(function*() {
			const sessions = yield* listProviderSessionsHandler(discoveryStub, projectsStub([]), {
				projectPath: PROJECT_PATH
			})
			Vitest.assert.deepStrictEqual(idsFrom(sessions), ["started-by-acepe"])
		}))

	Vitest.it.effect("ignores a deleted project row carrying the same workspace root", () =>
		Effect.gen(function*() {
			const deleted: ProjectedProject = { ...project(true), deletedAt: NOW }
			const sessions = yield* listProviderSessionsHandler(
				discoveryStub,
				projectsStub([deleted]),
				{ projectPath: PROJECT_PATH }
			)
			Vitest.assert.deepStrictEqual(idsFrom(sessions), ["started-by-acepe"])
		}))
})
