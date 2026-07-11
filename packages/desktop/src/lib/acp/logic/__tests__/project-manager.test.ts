import { afterEach, describe, expect, it, vi } from "vitest";
import { okAsync } from "neverthrow";

import { ProjectManager, type Project } from "../project-manager.svelte.js";

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
	const getProjects = vi.fn(() => okAsync(options.storageProjects));
	const getRecentProjects = vi.fn((_limit: number, _preferredPaths: string[], _offset: number) =>
		okAsync(options.storageProjects)
	);
	const writeCachedProjects = vi.fn((_projects: readonly Project[]) => {});
	const client = {
		getProjects,
		getRecentProjects,
		getCachedProjects: vi.fn(() => options.cachedProjects),
		writeCachedProjects,
		browseProject: vi.fn(() => okAsync(null as Project | null)),
		importProject: vi.fn((project: Project) => okAsync(project)),
		addProject: vi.fn((_project: Project) => okAsync(undefined)),
		updateProjectColor: vi.fn((path: string, _color: string) =>
			okAsync(createProject(path, "Updated"))
		),
		updateProjectIcon: vi.fn((path: string, _iconPath: string | null) =>
			okAsync(createProject(path, "Updated"))
		),
		listProjectImages: vi.fn((_projectPath: string) => okAsync([] as string[])),
		updateProjectShowExternalCliSessions: vi.fn((_path: string, value: boolean) =>
			okAsync({
				setupScript: "",
				runScript: "",
				showExternalCliSessions: value,
			})
		),
		browseProjectIcon: vi.fn(() => okAsync(null as string | null)),
		backfillProjectIcons: vi.fn(() => okAsync(0)),
		updateProjectOrder: vi.fn((_orderedPaths: string[]) => okAsync(options.storageProjects)),
		removeProject: vi.fn((_path: string) => okAsync(undefined)),
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

		const result = await manager.loadProjects();

		expect(result.isOk()).toBe(true);
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

		const result = await manager.loadProjects();

		expect(result.isOk()).toBe(true);
		expect(projectClient.getRecentProjects).toHaveBeenCalledWith(50, [], 0);
		expect(projectClient.getProjects).not.toHaveBeenCalled();
		expect(manager.projects).toEqual([firstProject, secondProject]);
		expect(manager.projectCount).toBe(2);
		expect(manager.getLastLoadPerformanceTrace()?.getProjectCountMs).toBe(0);
		expect(manager.getLastLoadPerformanceTrace()?.projectCount).toBe(2);
		expect(projectClient.writeCachedProjects).toHaveBeenCalledWith([firstProject, secondProject]);
	});
});
