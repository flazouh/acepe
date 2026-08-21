import * as Effect from "effect/Effect";
import * as Result from "effect/Result";
import { afterEach, describe, expect, it, vi } from "vitest";

import { type Project, ProjectManager } from "../project-manager.svelte.js";

type ProjectManagerClient = NonNullable<ConstructorParameters<typeof ProjectManager>[0]>;

function createProject(path: string, name: string): Project {
	return {
		path,
		name,
		createdAt: new Date("2026-01-01T00:00:00.000Z"),
		color: "cyan",
	};
}

function createProjectClient(options: {
	readonly cachedProjects: Project[] | null;
	readonly storageProjects: Project[];
}) {
	const getProjects = vi.fn(() => Effect.succeed(options.storageProjects));
	const getRecentProjects = vi.fn((_limit: number, _preferredPaths: string[], _offset: number) =>
		Effect.succeed(options.storageProjects)
	);
	const writeCachedProjects = vi.fn((_projects: readonly Project[]) => {});
	const client = {
		getProjects,
		getRecentProjects,
		getCachedProjects: vi.fn(() => options.cachedProjects),
		writeCachedProjects,
		browseProject: vi.fn(() => Effect.succeed(null as Project | null)),
		importProject: vi.fn((project: Project) => Effect.succeed(project)),
		addProject: vi.fn((_project: Project) => Effect.succeed(undefined)),
		updateProjectColor: vi.fn((path: string, _color: string) =>
			Effect.succeed(createProject(path, "Updated"))
		),
		updateProjectIcon: vi.fn((path: string, _iconPath: string | null) =>
			Effect.succeed(createProject(path, "Updated"))
		),
		listProjectImages: vi.fn((_projectPath: string) => Effect.succeed([] as string[])),
		updateProjectShowExternalCliSessions: vi.fn((_path: string, value: boolean) =>
			Effect.succeed({
				setupScript: "",
				runScript: "",
				showExternalCliSessions: value,
			})
		),
		browseProjectIcon: vi.fn(() => Effect.succeed(null as string | null)),
		backfillProjectIcons: vi.fn(() => Effect.succeed(0)),
		updateProjectOrder: vi.fn((_orderedPaths: string[]) => Effect.succeed(options.storageProjects)),
		removeProject: vi.fn((_path: string) => Effect.succeed(undefined)),
	} satisfies ProjectManagerClient;

	return {
		client,
		getProjects,
		getRecentProjects,
		writeCachedProjects,
	};
}

afterEach(() => {
	if (vi.isFakeTimers()) {
		vi.runOnlyPendingTimers();
		vi.clearAllTimers();
		vi.useRealTimers();
	}
});

describe("ProjectManager", () => {
	it("selects projects by path from the indexed project map", () => {
		const manager = new ProjectManager();
		const firstProject = createProject("/repo/one", "One");
		const secondProject = createProject("/repo/two", "Two");

		manager.projects = [firstProject, secondProject];

		expect(manager.getProject("/repo/one")).toEqual(firstProject);
		expect(manager.getProject("/repo/two")).toEqual(secondProject);
		expect(manager.getProject("/repo/missing")).toBeUndefined();
	});

	it("revalidates cached projects with the bounded preferred page", async () => {
		const cachedProject = createProject("/repo/cached", "Cached");
		const storageProject = createProject("/repo/storage", "Storage");
		const projectClient = createProjectClient({
			cachedProjects: [cachedProject],
			storageProjects: [storageProject],
		});
		const manager = new ProjectManager(projectClient.client);

		const result = await Effect.runPromise(Effect.result(manager.loadProjects()));

		expect(Result.isSuccess(result)).toBe(true);
		expect(manager.projects).toEqual([storageProject]);
		expect(manager.projectCount).toBe(1);
		expect(projectClient.getProjects).not.toHaveBeenCalled();
		expect(projectClient.getRecentProjects).toHaveBeenCalledWith(50, [], 0);
	});

	it("loads storage directly and derives project count when the cache is empty", async () => {
		const firstProject = createProject("/repo/one", "One");
		const secondProject = createProject("/repo/two", "Two");
		const projectClient = createProjectClient({
			cachedProjects: null,
			storageProjects: [firstProject, secondProject],
		});
		const manager = new ProjectManager(projectClient.client);

		const result = await Effect.runPromise(Effect.result(manager.loadProjects()));

		expect(Result.isSuccess(result)).toBe(true);
		expect(projectClient.getRecentProjects).toHaveBeenCalledWith(50, [], 0);
		expect(projectClient.getProjects).not.toHaveBeenCalled();
		expect(manager.projects).toEqual([firstProject, secondProject]);
		expect(manager.projectCount).toBe(2);
		expect(manager.getLastLoadPerformanceTrace()?.getProjectCountMs).toBe(0);
		expect(manager.getLastLoadPerformanceTrace()?.projectCount).toBe(2);
		expect(projectClient.writeCachedProjects).toHaveBeenCalledWith([firstProject, secondProject]);
	});
});
