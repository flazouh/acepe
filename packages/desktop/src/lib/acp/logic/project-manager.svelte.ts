import type { RpcProjectedProject } from "@acepe/contracts";
import { resolveProjectColor } from "@acepe/ui/colors";
import { computeProjectBadgeLabels } from "@acepe/ui/project-letter-badge";
import * as Effect from "effect/Effect";
import { SvelteDate, SvelteMap } from "svelte/reactivity";
import { tryIsoToDate } from "$lib/acp/store/services/session-projection-merge.js";
import type { SessionStore } from "$lib/acp/store/session-store.svelte.js";
import { ProjectClient } from "./project-client.js";

/**
 * Represents a project folder.
 */
export interface Project {
	path: string;
	name: string;
	lastOpened?: Date;
	createdAt: Date;
	color: string;
	sortOrder?: number;
	/**
	 * A per-project image for the badge, in place of its letter. Nothing sets
	 * one today: a project icon has no home on the server, so the menu items
	 * that used to pick and clear one were removed. The badge falls back to the
	 * letter whenever this is absent, which is always.
	 */
	iconPath?: string | null;
	showExternalCliSessions?: boolean;
	/**
	 * The server-assigned orchestration projectId, when known. Only set for
	 * projects sourced from the library/orchestration snapshot
	 * (computeMissingLibraryProjects) -- legacy on-disk projects imported
	 * through the folder-picker flow predate the orchestration engine and have
	 * no id. Two projects can legitimately share `path` (workspace_root) while
	 * having distinct `id`s (AC #266: a duplicate-workspace-root project
	 * created before the server rejected that); UI lists must key by `id` when
	 * present instead of `path` to stay safe under Svelte's {#each} keyed
	 * blocks.
	 */
	id?: string;
}

export interface ProjectLoadPerformanceTrace {
	readonly totalMs: number;
	readonly getProjectCountMs: number;
	readonly getProjectsMs: number;
	readonly assignStateMs: number;
	readonly projectCount: number;
}

/**
 * Error types for project operations.
 */
export class ProjectError extends Error {
	constructor(
		message: string,
		public readonly code: ProjectErrorCode,
		public readonly cause?: Error
	) {
		super(message);
		this.name = "ProjectError";
	}
}

export type ProjectErrorCode = "STORAGE_ERROR" | "INVALID_PATH" | "PROJECT_NOT_FOUND";

export function isUnexpectedProjectError(error: ProjectError): boolean {
	return error.code === "STORAGE_ERROR";
}

function roundProjectLoadPerformanceMs(value: number): number {
	return Math.round(value * 100) / 100;
}

/**
 * Computes the local `Project` rows to add for library (orchestration
 * projection) projects that have no entry in `existingProjects` yet.
 *
 * Sessions dispatched via session.create are unioned into the sidebar's
 * session list from the same library snapshot (see
 * SessionRepository.scanSessionProjections / mergeProjectionSessions), but
 * that union only ever widened the session list, never the project list it
 * is filtered against. A session whose project was never separately added
 * through the normal "add project" flow (no on-disk directory, so nothing
 * ever imported it) has a `projectPath` that never appears in
 * `recentProjects` -- session-list.svelte's `projectPaths.has(s.projectPath)`
 * filter then silently drops it from the sidebar, even though the session
 * itself is present in the store. This closes that gap by unioning the same
 * library snapshot's `projects` array into local project state, mirroring
 * mergeProjectionSessions' own dedupe rule: an existing project (by path)
 * always wins, and a deleted library row is skipped. The color comes from the
 * library row, which always carries one; only sort order and icon stay local.
 *
 * Additions are appended after the existing projects (increasing sortOrder)
 * rather than inserted at the front, so a passive background reconciliation
 * never reorders a project the user placed deliberately.
 */
export function computeMissingLibraryProjects(
	existingProjects: readonly Project[],
	libraryProjects: readonly RpcProjectedProject[]
): Project[] {
	// Identity has two tiers. A project we already know by its exact id is
	// always the same project (never re-added). A path already claimed by a
	// legacy, id-less local project (imported through the folder picker,
	// predating the orchestration engine) is treated as the same project too
	// -- that pairing is intentional, not a duplicate. A path shared between
	// two projects that both carry distinct ids is NOT collapsed: that is the
	// real duplicate-workspace-root case (AC #266), and hiding the second one
	// by path alone silently lost a real project instead of representing it.
	const knownIds = new Set(
		existingProjects.map((project) => project.id).filter((id): id is string => id !== undefined)
	);
	const knownLegacyPaths = new Set(
		existingProjects.filter((project) => project.id === undefined).map((project) => project.path)
	);
	const additions: Project[] = [];
	for (const libraryProject of libraryProjects) {
		if (libraryProject.deletedAt !== null) {
			continue;
		}
		const projectId = String(libraryProject.projectId);
		if (knownIds.has(projectId) || knownLegacyPaths.has(libraryProject.workspaceRoot)) {
			continue;
		}
		// A malformed row (a schema-boundary bug upstream, per tryIsoToDate's
		// contract) must drop only that row, not the whole batch -- same
		// defensive rule mergeProjectionSessions applies to the sibling
		// session union.
		const createdAt = tryIsoToDate(libraryProject.createdAt);
		if (createdAt === null) {
			continue;
		}
		knownIds.add(projectId);
		additions.push({
			id: projectId,
			path: libraryProject.workspaceRoot,
			name: libraryProject.title,
			color: resolveProjectColor(libraryProject.color),
			createdAt,
			// The projection owns the rank, so carry its value. A rank invented
			// here would be a second author for a canonical field, and it reaches
			// the hot cache and outlives a reload.
			sortOrder: libraryProject.sortOrder ?? undefined,
			iconPath: null,
		});
	}
	return additions;
}

/**
 * Corrects a known project's local `path` back to the server-authoritative
 * library snapshot's `workspaceRoot`, when the two disagree.
 *
 * AC-271: the hot cache (`acepe.projects.hot_cache` in localStorage) is not
 * scoped per Electrobun instance, so a corrupted or foreign cache entry
 * (observed live: hyphens where slashes belong, a wrong app-id token) can
 * render for a project this instance's own server already knows the real
 * root for -- computeMissingLibraryProjects only ever ADDS a project it
 * doesn't recognize by id, it never corrects one it does. This closes that
 * gap: for every project this instance's own library snapshot reports (by
 * id), that snapshot's `workspaceRoot` always wins over whatever the local
 * `path` currently says, cache-derived or not. A deleted library row is
 * never used to correct a root -- same rule computeMissingLibraryProjects
 * applies to additions. An id-less legacy project (predates the
 * orchestration engine, see the `Project.id` doc) has nothing to reconcile
 * against and is left untouched.
 *
 * Returns the same array reference when nothing needed correcting, so a
 * caller can cheaply detect "no-op" the same way computeMissingLibraryProjects's
 * empty-additions case already does.
 */
export function reconcileKnownProjectRoots(
	existingProjects: readonly Project[],
	libraryProjects: readonly RpcProjectedProject[]
): readonly Project[] {
	const rootById = new Map<string, string>();
	for (const libraryProject of libraryProjects) {
		if (libraryProject.deletedAt !== null) {
			continue;
		}
		rootById.set(String(libraryProject.projectId), libraryProject.workspaceRoot);
	}

	let changed = false;
	const corrected = existingProjects.map((project) => {
		if (project.id === undefined) {
			return project;
		}
		const authoritativeRoot = rootById.get(project.id);
		if (authoritativeRoot === undefined || authoritativeRoot === project.path) {
			return project;
		}
		changed = true;
		return { ...project, path: authoritativeRoot };
	});
	return changed ? corrected : existingProjects;
}

type ProjectClientPort = Pick<
	ProjectClient,
	| "getProjects"
	| "getRecentProjects"
	| "getCachedProjects"
	| "writeCachedProjects"
	| "browseProject"
	| "importProject"
	| "addProject"
	| "updateProjectColor"
	| "updateProjectShowExternalCliSessions"
	| "updateProjectOrder"
	| "removeProject"
>;

interface ProjectLoadTraceTiming {
	readonly totalStartedAtMs: number;
	readonly getProjectsMs: number;
	readonly getProjectCountMs: number;
	readonly recordTrace: boolean;
}

interface ProjectStorageLoadOptions {
	readonly showLoading: boolean;
	readonly recordTrace: boolean;
	readonly firstPageOnly: boolean;
	readonly preferredPaths: string[];
}

/**
 * Manages project state and storage.
 *
 * Uses Svelte 5 runes for reactive state management.
 * All data is persisted in the SQLite database behind the backend server.
 *
 * Projects represent folders in the workspace. When a project is imported,
 * session scanning is triggered to discover sessions from all supported
 * agents (Claude Code, Cursor, OpenCode, etc.).
 */
export class ProjectManager {
	private readonly client: ProjectClientPort;
	private sessionStore: SessionStore | null = null;
	private lastLoadPerformanceTrace: ProjectLoadPerformanceTrace | null = null;
	private nextProjectPageOffset = 50;

	/**
	 * Total count of projects in the database.
	 * null = not yet loaded, 0+ = actual count.
	 */
	projectCount = $state<number | null>(null);

	/**
	 * All projects from the database.
	 */
	projects = $state<Project[]>([]);

	/**
	 * Cached projects may render UI, but storage-backed data is required for startup side effects.
	 */
	projectStorageFresh = $state(false);

	readonly projectByPath = $derived.by(
		() => new SvelteMap(this.projects.map((project) => [project.path, project]))
	);

	/**
	 * Disambiguating badge label per project path, computed globally across all
	 * projects. Projects with distinct first letters get a single letter ("A");
	 * collisions grow the prefix until unique ("Ac" / "Ap").
	 */
	readonly badgeLabelByPath = $derived.by(() =>
		computeProjectBadgeLabels(
			this.projects.map((project) => ({ key: project.path, name: project.name }))
		)
	);

	/**
	 * Resolve the disambiguating badge label for a project path. Falls back to
	 * the project's first letter when the path is unknown (e.g. not yet loaded).
	 */
	getProjectBadgeLabel(path: string): string | undefined {
		return this.badgeLabelByPath.get(path);
	}

	/**
	 * Whether projects are currently loading.
	 */
	isLoading = $state(false);

	/**
	 * Current error, if any.
	 */
	error = $state<ProjectError | null>(null);

	constructor(client: ProjectClientPort = new ProjectClient()) {
		this.client = client;
		// Note: loadProjects() should be called explicitly after construction
		// Do NOT call it here as it modifies $state during initialization
		// which can cause infinite loops in Svelte 5
	}

	private assignLoadedProjects(projects: Project[], timing: ProjectLoadTraceTiming): void {
		const assignStateStartedAtMs = performance.now();
		this.projectCount = projects.length;
		this.projects = projects;
		this.client.writeCachedProjects(projects);
		const assignStateMs = performance.now() - assignStateStartedAtMs;
		if (timing.recordTrace) {
			this.lastLoadPerformanceTrace = {
				totalMs: roundProjectLoadPerformanceMs(performance.now() - timing.totalStartedAtMs),
				getProjectCountMs: roundProjectLoadPerformanceMs(timing.getProjectCountMs),
				getProjectsMs: roundProjectLoadPerformanceMs(timing.getProjectsMs),
				assignStateMs: roundProjectLoadPerformanceMs(assignStateMs),
				projectCount: projects.length,
			};
		}
	}

	private loadProjectsFromStorage(
		options: ProjectStorageLoadOptions
	): Effect.Effect<void, ProjectError> {
		if (options.showLoading) {
			this.isLoading = true;
			this.error = null;
		}

		const totalStartedAtMs = performance.now();
		const projectsStartedAtMs = performance.now();

		const projectsRequest = options.firstPageOnly
			? this.client.getRecentProjects(50, options.preferredPaths, 0)
			: this.client.getProjects();

		return projectsRequest.pipe(
			Effect.map((projects) => ({
				projects,
				durationMs: performance.now() - projectsStartedAtMs,
			})),
			Effect.map((projectsResult) => {
				if (options.firstPageOnly) {
					const preferred = new Set(options.preferredPaths);
					this.nextProjectPageOffset = projectsResult.projects.filter(
						(project) => !preferred.has(project.path)
					).length;
				}
				this.assignLoadedProjects(projectsResult.projects, {
					totalStartedAtMs,
					getProjectCountMs: 0,
					getProjectsMs: projectsResult.durationMs,
					recordTrace: options.recordTrace,
				});
				this.projectStorageFresh = true;
				if (options.showLoading) {
					this.isLoading = false;
				}
			}),
			Effect.mapError((error) => {
				if (options.showLoading) {
					this.error = error;
					this.isLoading = false;
				}
				return error;
			})
		);
	}

	private writeCurrentProjectsToCache(): void {
		this.client.writeCachedProjects(this.projects);
	}

	private loadRemainingProjectPages(offset: number): void {
		void Effect.runPromise(
			this.client.getRecentProjects(50, [], offset).pipe(
				Effect.match({
					onSuccess: (projects) => {
						if (projects.length === 0) return;
						const knownPaths = new Set(this.projects.map((project) => project.path));
						const additions = projects.filter((project) => !knownPaths.has(project.path));
						this.projects = this.projects.concat(additions);
						this.projectCount = this.projects.length;
						this.writeCurrentProjectsToCache();
						if (projects.length === 50) this.loadRemainingProjectPages(offset + 50);
					},
					onFailure: (error) => console.warn("Later project page failed:", error),
				})
			)
		);
	}

	getProject(path: string): Project | undefined {
		return this.projectByPath.get(path);
	}

	/**
	 * Set the session store instance.
	 * Must be called before calling importProject().
	 *
	 * @param store The session store instance
	 */
	setSessionStore(store: SessionStore): void {
		this.sessionStore = store;
	}

	/**
	 * Load projects from database.
	 * Uses the hot cache first, then refreshes from storage after first paint.
	 *
	 * @returns Effect containing void on success
	 */
	loadProjects(preferredPaths: string[] = []): Effect.Effect<void, ProjectError> {
		this.error = null;
		const totalStartedAtMs = performance.now();

		const cachedProjects = this.client.getCachedProjects();
		if (cachedProjects !== null) {
			this.isLoading = false;
			this.projectStorageFresh = false;
			this.assignLoadedProjects(cachedProjects, {
				totalStartedAtMs,
				getProjectCountMs: 0,
				getProjectsMs: 0,
				recordTrace: true,
			});
			return this.loadProjectsFromStorage({
				showLoading: false,
				recordTrace: false,
				firstPageOnly: true,
				preferredPaths,
			}).pipe(
				Effect.map(() => {
					this.loadRemainingProjectPages(this.nextProjectPageOffset);
				}),
				Effect.catch((error) => {
					console.warn("Preferred project page refresh failed:", error);
					return Effect.succeed(undefined);
				})
			);
		}

		return this.loadProjectsFromStorage({
			showLoading: true,
			recordTrace: true,
			firstPageOnly: true,
			preferredPaths,
		}).pipe(
			Effect.map(() => {
				this.loadRemainingProjectPages(this.nextProjectPageOffset);
			})
		);
	}

	getLastLoadPerformanceTrace(): ProjectLoadPerformanceTrace | null {
		return this.lastLoadPerformanceTrace;
	}

	/**
	 * Import a project (browse for it, add to workspace, trigger scanning).
	 * Opens native file picker, adds project to workspace, and triggers session scanning.
	 *
	 * @returns Effect containing the imported project, or null if cancelled
	 */
	importProject(): Effect.Effect<Project | null, ProjectError> {
		return this.client.browseProject().pipe(
			Effect.flatMap((project) => {
				if (!project) {
					// User cancelled the file picker
					return Effect.succeed(null);
				}

				// Import on backend (adds to DB, auto-detects icon)
				return this.client.importProject(project).pipe(
					Effect.map((importedProject) => {
						// Check if this is a new project
						const existingIndex = this.projects.findIndex((p) => p.path === importedProject.path);
						const isNew = existingIndex < 0;

						// Update projects list with the backend result (carries detected icon_path)
						if (isNew) {
							// The imported project arrives with whatever rank the
							// projection gave it, normally none. Renumbering the rest of
							// the list here would write a canonical field nobody
							// dispatched, and the list would jump on the next load.
							this.projects = [importedProject, ...this.projects];
							// Update count only for new projects
							if (this.projectCount !== null) {
								this.projectCount = this.projectCount + 1;
							}
						} else {
							this.projects = this.projects.map((p, i) =>
								i === existingIndex ? importedProject : p
							);
						}
						this.writeCurrentProjectsToCache();
						this.projectStorageFresh = true;

						// Trigger session scan for the imported project (fire and forget)
						if (this.sessionStore) {
							void Effect.runPromise(
								(
									this.sessionStore.loading.scanSessions([importedProject.path]) as Effect.Effect<
										unknown,
										Error
									>
								).pipe(
									Effect.match({
										onSuccess: () => undefined,
										onFailure: (error) => {
											console.warn("Session scan failed:", error);
										},
									})
								)
							);
						}

						return importedProject;
					})
				);
			})
		);
	}

	/**
	 * Add a project.
	 *
	 * @param project - The project to add
	 * @returns Effect indicating success or error
	 */
	addProject(project: Project): Effect.Effect<void, ProjectError> {
		return this.client.addProject(project).pipe(
			Effect.flatMap(() => {
				// Reload projects to get updated list
				return this.loadProjectsFromStorage({
					showLoading: true,
					recordTrace: true,
					firstPageOnly: false,
					preferredPaths: [],
				});
			})
		);
	}

	/**
	 * Union library (orchestration projection) projects into local project
	 * state so a session dispatched for a project with no on-disk presence
	 * still has a home in `recentProjects` -- see
	 * computeMissingLibraryProjects for the "why" -- and correct any known
	 * project's root that has drifted from this instance's own
	 * server-authoritative snapshot -- see reconcileKnownProjectRoots for
	 * the "why" (AC-271 cross-instance localStorage bleed). A no-op when
	 * every library project is already known and every known root already
	 * matches, so a routine startup reconciliation with nothing to change
	 * never touches `projects` and never triggers a downstream re-render.
	 */
	mergeLibraryProjects(libraryProjects: readonly RpcProjectedProject[]): void {
		const reconciled = reconcileKnownProjectRoots(this.projects, libraryProjects);
		const additions = computeMissingLibraryProjects(reconciled, libraryProjects);
		if (additions.length === 0 && reconciled === this.projects) {
			return;
		}
		this.projects = [...reconciled, ...additions];
		this.projectCount = this.projects.length;
		this.writeCurrentProjectsToCache();
	}

	/**
	 * Add a project optimistically to local state.
	 * Use this when the project has already been added to the backend (via import_project)
	 * to immediately update the UI while a full reload happens in the background.
	 *
	 * @param path - The project path
	 * @param name - The project name
	 * @param color - The project color (defaults to "cyan")
	 */
	addProjectOptimistic(path: string, name: string, color = "cyan"): void {
		// Check if project already exists
		const existingIndex = this.projects.findIndex((p) => p.path === path);
		if (existingIndex >= 0) {
			// Project already exists, no need to add
			return;
		}

		// Create optimistic project and add to beginning of list
		// Unranked, like every project the projection has not been asked to
		// order. Ranking it 0 and shifting everyone else would write a canonical
		// field nobody dispatched: the new project would show first, then drop to
		// its real place on the next load.
		const optimisticProject: Project = {
			path,
			name,
			color: resolveProjectColor(color),
			lastOpened: new SvelteDate(),
			createdAt: new SvelteDate(),
			iconPath: null,
		};

		this.projects = [optimisticProject, ...this.projects];

		// Update count
		this.projectCount = (this.projectCount ?? 0) + 1;
		this.projectStorageFresh = false;
		this.writeCurrentProjectsToCache();
	}

	/**
	 * Update a project's color.
	 *
	 * @param path - The project path
	 * @param color - The new color (color name like "red" or hex like "#FF5D5A")
	 * @returns Effect indicating success or error
	 */
	updateProjectColor(path: string, color: string): Effect.Effect<void, ProjectError> {
		return this.client.updateProjectColor(path, color).pipe(
			Effect.map((updatedProject) => {
				// Update the project in the projects list
				const existingIndex = this.projects.findIndex((p) => p.path === path);
				if (existingIndex >= 0) {
					this.projects = this.projects.map((p, i) => (i === existingIndex ? updatedProject : p));
					this.projectStorageFresh = true;
					this.writeCurrentProjectsToCache();
				}
			})
		);
	}

	updateProjectShowExternalCliSessions(
		path: string,
		value: boolean
	): Effect.Effect<void, ProjectError> {
		return this.client.updateProjectShowExternalCliSessions(path, value).pipe(
			Effect.map(() => {
				const existingIndex = this.projects.findIndex((project) => project.path === path);
				if (existingIndex >= 0) {
					this.projects = this.projects.map((project, index) =>
						index === existingIndex
							? {
									path: project.path,
									name: project.name,
									lastOpened: project.lastOpened,
									createdAt: project.createdAt,
									color: project.color,
									sortOrder: project.sortOrder,
									showExternalCliSessions: value,
								}
							: project
					);
					this.projectStorageFresh = true;
					this.writeCurrentProjectsToCache();
				}
			}),
			Effect.flatMap(() => {
				if (this.sessionStore === null) {
					return Effect.succeed(undefined);
				}

				return (
					this.sessionStore.loading.scanSessions([path]) as Effect.Effect<unknown, Error>
				).pipe(
					Effect.mapError(
						(error) =>
							new ProjectError(
								`Failed to refresh project sessions: ${error.message}`,
								"STORAGE_ERROR",
								error instanceof Error ? error : undefined
							)
					),
					Effect.map(() => undefined)
				);
			})
		);
	}

	updateProjectOrder(orderedPaths: string[]): Effect.Effect<void, ProjectError> {
		return this.client.updateProjectOrder(orderedPaths).pipe(
			Effect.map((updatedProjects) => {
				this.projects = updatedProjects;
				this.projectCount = updatedProjects.length;
				this.projectStorageFresh = true;
				this.writeCurrentProjectsToCache();
			}),
			// A move writes one command per project it moved, so a failure part
			// way through leaves the server holding some of the new ranks and
			// none of the rest. Re-read rather than keep showing the order the
			// user had before, which the server no longer agrees with.
			Effect.tapError(() =>
				this.loadProjectsFromStorage({
					showLoading: false,
					recordTrace: false,
					firstPageOnly: false,
					preferredPaths: [],
				}).pipe(Effect.ignore)
			)
		);
	}

	/**
	 * Remove a project.
	 *
	 * @param path - The project path to remove
	 * @returns Effect indicating success or error
	 */
	removeProject(path: string): Effect.Effect<void, ProjectError> {
		return this.client.removeProject(path).pipe(
			Effect.flatMap(() => {
				// Reload projects to get updated list
				return this.loadProjectsFromStorage({
					showLoading: true,
					recordTrace: true,
					firstPageOnly: false,
					preferredPaths: [],
				});
			})
		);
	}

	/**
	 * Clear all projects.
	 *
	 * @returns Effect indicating success or error
	 */
	clearProjects(): Effect.Effect<void, ProjectError> {
		// Remove all projects sequentially
		let result: Effect.Effect<void, ProjectError> = Effect.succeed(undefined);

		for (const project of this.projects) {
			result = result.pipe(Effect.flatMap(() => this.client.removeProject(project.path)));
		}

		return result.pipe(
			Effect.flatMap(() => {
				this.projects = [];
				this.projectCount = 0;
				this.projectStorageFresh = true;
				this.writeCurrentProjectsToCache();
				return Effect.succeed(undefined);
			})
		);
	}

	/**
	 * Browse for a project folder.
	 *
	 * @returns Effect containing the selected project or null
	 */
	browseProject(): Effect.Effect<Project | null, ProjectError> {
		return this.client.browseProject();
	}

	/**
	 * Extract project name from path.
	 *
	 * @param path - The full path
	 * @returns The folder name
	 */
	static getProjectNameFromPath(path: string): string {
		const parts = path.split("/").filter(Boolean);
		return parts[parts.length - 1] || path;
	}
}
