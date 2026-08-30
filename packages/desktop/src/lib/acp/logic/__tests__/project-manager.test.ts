import type { ProjectIcon } from "@acepe/contracts";
import { PROJECT_ICON_AUTO, ProjectId, type RpcProjectedProject } from "@acepe/contracts";
import { Colors } from "@acepe/ui/colors";
import * as Effect from "effect/Effect";
import * as Result from "effect/Result";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
	computeMissingLibraryProjects,
	type Project,
	ProjectManager,
	reconcileKnownProjectRoots,
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
		showExternalCliSessions: false,
		sortOrder: null,
		icon: PROJECT_ICON_AUTO,
		iconPath: null,
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
		updateProjectIcon: vi.fn((path: string, _icon: ProjectIcon) =>
			Effect.succeed(createProject(path, "Updated"))
		),
		updateProjectShowExternalCliSessions: vi.fn((_path: string, value: boolean) =>
			Effect.succeed({
				setupScript: "",
				runScript: "",
				showExternalCliSessions: value,
			})
		),
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

	// The projection owns the rank. An optimistic add that renumbers the list
	// locally is a second author for that field: the new project shows at the
	// top, then drops to where the projection actually put it on the next load.
	it("adds a project optimistically without renumbering the ranked list", () => {
		const manager = new ProjectManager();
		const first = createProject("/repo/one", "One");
		first.sortOrder = 0;
		const second = createProject("/repo/two", "Two");
		second.sortOrder = 1;
		manager.projects = [first, second];

		manager.addProjectOptimistic("/repo/three", "Three");

		const ranks = manager.projects.map((project) => [project.path, project.sortOrder]);
		expect(ranks).toEqual(
			expect.arrayContaining([
				["/repo/one", 0],
				["/repo/two", 1],
				["/repo/three", undefined],
			])
		);
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
				// Unranked. The projection owns the rank and hands out none until
				// someone moves a project, so the merge must not invent one.
				sortOrder: undefined,
				// The icon comes across the same way: the server resolved it, so
				// the merge carries its answer rather than probing the filesystem.
				icon: { kind: "auto" },
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

	// The projection owns the rank, so the merge reads the library row's own and
	// never invents one. An invented rank is a second author for a canonical
	// field, and it reaches the hot cache and outlives a reload.
	it("carries the library row's own rank and leaves existing ranks alone", () => {
		const existing = createProject("/repo/one", "One");
		existing.sortOrder = 5;

		const additions = computeMissingLibraryProjects(
			[existing],
			[libraryProject({ workspaceRoot: "/tmp/acepe", sortOrder: 2 })]
		);

		expect(additions).toHaveLength(1);
		expect(additions[0]?.sortOrder).toBe(2);
		expect(existing.sortOrder).toBe(5);
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

	// AC-271: the hot cache (localStorage 'acepe.projects.hot_cache') is not
	// scoped per Electrobun instance, so a corrupted or foreign entry from
	// another instance can render on boot before the real per-instance
	// storage load replaces it. This proves the routine startup
	// reconciliation (this same union, run against THIS instance's own
	// server-authoritative library snapshot) corrects a known project's
	// root back to truth instead of leaving the cache-sourced value in
	// place indefinitely.
	it("corrects a known project's cached root when it disagrees with the library snapshot", () => {
		const manager = new ProjectManager();
		const corrupted = createProject("com-acepe-app-qa-dbpath-Users-alex-project", "Acepe");
		corrupted.id = "project-1";
		manager.projects = [corrupted];
		manager.projectCount = 1;

		manager.mergeLibraryProjects([libraryProject({ projectId: ProjectId.make("project-1") })]);

		expect(manager.projects).toEqual([{ ...corrupted, path: "/tmp/acepe" }]);
		expect(manager.projectCount).toBe(1);
	});
});

describe("reconcileKnownProjectRoots", () => {
	it("corrects a known-id project's path to the library snapshot's workspaceRoot", () => {
		const stale = createProject("/wrong/stale-root", "Acepe");
		stale.id = "project-1";

		const corrected = reconcileKnownProjectRoots(
			[stale],
			[libraryProject({ projectId: ProjectId.make("project-1"), workspaceRoot: "/real/root" })]
		);

		expect(corrected).toEqual([{ ...stale, path: "/real/root" }]);
	});

	it("leaves an id-less legacy project untouched, even if a library row shares its path key coincidentally", () => {
		const legacy = createProject("/tmp/acepe", "Acepe (local)");

		const corrected = reconcileKnownProjectRoots([legacy], [libraryProject()]);

		expect(corrected).toEqual([legacy]);
		expect(corrected[0]).toBe(legacy);
	});

	it("is a referential no-op when every known root already matches", () => {
		const existing = createProject("/tmp/acepe", "Acepe");
		existing.id = "project-1";
		const existingProjects = [existing];

		const corrected = reconcileKnownProjectRoots(existingProjects, [libraryProject()]);

		expect(corrected).toBe(existingProjects);
	});

	it("leaves a project's root alone when the library snapshot has no row for its id", () => {
		const existing = createProject("/repo/one", "One");
		existing.id = "project-unknown";

		const corrected = reconcileKnownProjectRoots([existing], [libraryProject()]);

		expect(corrected).toEqual([existing]);
	});

	it("skips a deleted library row instead of using it to correct a root", () => {
		const existing = createProject("/tmp/acepe", "Acepe");
		existing.id = "project-1";

		const corrected = reconcileKnownProjectRoots(
			[existing],
			[
				libraryProject({
					projectId: ProjectId.make("project-1"),
					workspaceRoot: "/deleted/root",
					deletedAt: "2026-08-21T00:00:00.000Z",
				}),
			]
		);

		expect(corrected).toEqual([existing]);
	});
});
