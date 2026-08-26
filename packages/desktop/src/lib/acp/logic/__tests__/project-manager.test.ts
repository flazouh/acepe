import { ProjectId, type RpcProjectedProject } from "@acepe/contracts";
import { Colors } from "@acepe/ui/colors";
import * as Effect from "effect/Effect";
import * as Result from "effect/Result";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
	computeMissingLibraryProjects,
	type Project,
	ProjectManager,
} from "../project-manager.svelte.js";

function libraryProject(overrides: Partial<RpcProjectedProject> = {}): RpcProjectedProject {
	return {
		projectId: ProjectId.make("project-1"),
		title: "Acepe",
		workspaceRoot: "/tmp/acepe",
		createdAt: "2026-08-20T12:00:00.000Z",
		updatedAt: "2026-08-20T12:00:00.000Z",
		deletedAt: null,
		sessionCount: 1,
		color: "cyan",
		gitStatus: [],
		...overrides,
	};
}

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

describe("computeMissingLibraryProjects", () => {
	// Regression: a session dispatched via session.create for a project with
	// no on-disk directory (so nothing ever imported it through the normal
	// "add project" flow) is unioned into the sidebar's session list by
	// SessionRepository.scanSessionProjections, but that union never touched
	// the project list session-list.svelte filters against -- the session
	// silently vanished from the sidebar on restart even though it was
	// present in the store. This closes that gap.
	it("adds a library project with no local entry", () => {
		const additions = computeMissingLibraryProjects([], [libraryProject()]);

		expect(additions).toEqual([
			{
				id: "project-1",
				path: "/tmp/acepe",
				name: "Acepe",
				color: Colors.cyan,
				createdAt: new Date("2026-08-20T12:00:00.000Z"),
				sortOrder: 0,
				iconPath: null,
			},
		]);
	});

	// Project.color is a resolved hex everywhere downstream, because the badge
	// interpolates it straight into color-mix(). A CSS keyword there would
	// paint a different color, and "amber" would paint nothing at all.
	it("resolves the library color name to the palette hex", () => {
		const additions = computeMissingLibraryProjects([], [libraryProject({ color: "amber" })]);

		expect(additions[0]?.color).toBe(Colors.amber);
	});

	it("does not add a project that already exists locally, by path", () => {
		const existing = createProject("/tmp/acepe", "Acepe (local)");

		const additions = computeMissingLibraryProjects([existing], [libraryProject()]);

		expect(additions).toEqual([]);
	});

	it("skips a deleted library project", () => {
		const additions = computeMissingLibraryProjects(
			[],
			[libraryProject({ deletedAt: "2026-08-21T00:00:00.000Z" })]
		);

		expect(additions).toEqual([]);
	});

	it("appends after existing projects instead of reordering them", () => {
		const existing = createProject("/repo/one", "One");
		existing.sortOrder = 5;

		const additions = computeMissingLibraryProjects(
			[existing],
			[libraryProject({ workspaceRoot: "/tmp/acepe" })]
		);

		expect(additions).toHaveLength(1);
		expect(additions[0]?.sortOrder).toBe(6);
	});

	it("dedupes multiple library projects at the same path", () => {
		const additions = computeMissingLibraryProjects(
			[],
			[libraryProject(), libraryProject({ title: "Acepe (dup)" })]
		);

		expect(additions).toHaveLength(1);
	});

	// Regression (AC #266): two distinct projects (different projectId) that
	// happen to share a workspace_root -- e.g. one created via raw
	// orchestration dispatch after another already claimed the same folder --
	// must both surface as real, separately-identified rows. Silently
	// dropping the second (the old workspaceRoot-only dedup key) hid a real
	// data-integrity problem from the user instead of representing it, and
	// left every {#each project.path} key downstream provably unsafe to key
	// by path once the server actually returns two such rows.
	it("keeps both library projects when they share a workspace_root but have distinct project ids", () => {
		const additions = computeMissingLibraryProjects(
			[],
			[
				libraryProject({ projectId: ProjectId.make("project-1") }),
				libraryProject({ projectId: ProjectId.make("project-2"), title: "Acepe (second)" }),
			]
		);

		expect(additions).toHaveLength(2);
		expect(additions.map((project) => project.id)).toEqual(["project-1", "project-2"]);
		expect(additions.every((project) => project.path === "/tmp/acepe")).toBe(true);
	});

	it("still treats a library project as known when an existing local project already claims its path", () => {
		const existing = createProject("/tmp/acepe", "Acepe (local)");

		const additions = computeMissingLibraryProjects(
			[existing],
			[libraryProject({ projectId: ProjectId.make("project-1") })]
		);

		expect(additions).toEqual([]);
	});
});

describe("ProjectManager.mergeLibraryProjects", () => {
	it("unions a library-only project into recentProjects", () => {
		const manager = new ProjectManager();
		manager.projects = [createProject("/repo/one", "One")];

		manager.mergeLibraryProjects([libraryProject()]);

		expect(manager.projects.map((p) => p.path)).toEqual(["/repo/one", "/tmp/acepe"]);
		expect(manager.projectCount).toBe(2);
	});

	it("is a no-op when every library project is already known", () => {
		const manager = new ProjectManager();
		const existing = createProject("/tmp/acepe", "Acepe");
		manager.projects = [existing];
		manager.projectCount = 1;

		manager.mergeLibraryProjects([libraryProject()]);

		expect(manager.projects).toEqual([existing]);
		expect(manager.projectCount).toBe(1);
	});
});
