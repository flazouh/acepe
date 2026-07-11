import { okAsync, ResultAsync } from "neverthrow";
import { SvelteDate, SvelteMap } from "svelte/reactivity";
import type { SessionStore } from "$lib/acp/store/session-store.svelte.js";

import { resolveProjectColor } from "@acepe/ui/colors";
import { computeProjectBadgeLabels } from "@acepe/ui/project-letter-badge";
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
	iconPath?: string | null;
	showExternalCliSessions?: boolean;
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
	| "updateProjectIcon"
	| "listProjectImages"
	| "updateProjectShowExternalCliSessions"
	| "browseProjectIcon"
	| "backfillProjectIcons"
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
 * All data is persisted in SQLite database via Tauri backend.
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
	): ResultAsync<void, ProjectError> {
		if (options.showLoading) {
			this.isLoading = true;
			this.error = null;
		}

		const totalStartedAtMs = performance.now();
		const projectsStartedAtMs = performance.now();

		const projectsRequest = options.firstPageOnly
			? this.client.getRecentProjects(50, options.preferredPaths, 0)
			: this.client.getProjects();

		return projectsRequest
			.map((projects) => ({
				projects,
				durationMs: performance.now() - projectsStartedAtMs,
			}))
			.map((projectsResult) => {
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
			})
			.mapErr((error) => {
				if (options.showLoading) {
					this.error = error;
					this.isLoading = false;
				}
				return error;
			});
	}

	private writeCurrentProjectsToCache(): void {
		this.client.writeCachedProjects(this.projects);
	}

	private loadRemainingProjectPages(offset: number): void {
		void this.client.getRecentProjects(50, [], offset).match(
			(projects) => {
				if (projects.length === 0) return;
				const knownPaths = new Set(this.projects.map((project) => project.path));
				const additions = projects.filter((project) => !knownPaths.has(project.path));
				this.projects = this.projects.concat(additions);
				this.projectCount = this.projects.length;
				this.writeCurrentProjectsToCache();
				if (projects.length === 50) this.loadRemainingProjectPages(offset + 50);
			},
			(error) => console.warn("Later project page failed:", error)
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
	 * @returns ResultAsync containing void on success
	 */
	loadProjects(preferredPaths: string[] = []): ResultAsync<void, ProjectError> {
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
			})
				.map(() => {
					this.loadRemainingProjectPages(this.nextProjectPageOffset);
				})
				.orElse((error) => {
					console.warn("Preferred project page refresh failed:", error);
					return okAsync(undefined);
				});
		}

		return this.loadProjectsFromStorage({
			showLoading: true,
			recordTrace: true,
			firstPageOnly: true,
			preferredPaths,
		}).map(() => {
			this.loadRemainingProjectPages(this.nextProjectPageOffset);
		});
	}

	getLastLoadPerformanceTrace(): ProjectLoadPerformanceTrace | null {
		return this.lastLoadPerformanceTrace;
	}

	/**
	 * Import a project (browse for it, add to workspace, trigger scanning).
	 * Opens native file picker, adds project to workspace, and triggers session scanning.
	 *
	 * @returns ResultAsync containing the imported project, or null if cancelled
	 */
	importProject(): ResultAsync<Project | null, ProjectError> {
		return this.client.browseProject().andThen((project) => {
			if (!project) {
				// User cancelled the file picker
				return okAsync(null);
			}

			// Import on backend (adds to DB, auto-detects icon)
			return this.client.importProject(project).map((importedProject) => {
				// Check if this is a new project
				const existingIndex = this.projects.findIndex((p) => p.path === importedProject.path);
				const isNew = existingIndex < 0;

				// Update projects list with the backend result (carries detected icon_path)
				if (isNew) {
					const shiftedProjects = this.projects.map((existingProject) => ({
						path: existingProject.path,
						name: existingProject.name,
						lastOpened: existingProject.lastOpened,
						createdAt: existingProject.createdAt,
						color: existingProject.color,
						sortOrder: existingProject.sortOrder !== undefined ? existingProject.sortOrder + 1 : 1,
						iconPath: existingProject.iconPath ?? null,
						showExternalCliSessions: existingProject.showExternalCliSessions,
					}));
					this.projects = [importedProject, ...shiftedProjects];
					// Update count only for new projects
					if (this.projectCount !== null) {
						this.projectCount = this.projectCount + 1;
					}
				} else {
					this.projects = this.projects.map((p, i) => (i === existingIndex ? importedProject : p));
				}
				this.writeCurrentProjectsToCache();
				this.projectStorageFresh = true;

				// Trigger session scan for the imported project (fire and forget)
				if (this.sessionStore) {
					this.sessionStore.loading.scanSessions([importedProject.path]).mapErr((error) => {
						console.warn("Session scan failed:", error);
					});
				}

				return importedProject;
			});
		});
	}

	/**
	 * Add a project.
	 *
	 * @param project - The project to add
	 * @returns ResultAsync indicating success or error
	 */
	addProject(project: Project): ResultAsync<void, ProjectError> {
		return this.client.addProject(project).andThen(() => {
			// Reload projects to get updated list
			return this.loadProjectsFromStorage({
				showLoading: true,
				recordTrace: true,
				firstPageOnly: false,
				preferredPaths: [],
			});
		});
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
		const optimisticProject: Project = {
			path,
			name,
			color: resolveProjectColor(color),
			lastOpened: new SvelteDate(),
			createdAt: new SvelteDate(),
			sortOrder: 0,
			iconPath: null,
		};

		const shiftedProjects = this.projects.map((existingProject) => ({
			path: existingProject.path,
			name: existingProject.name,
			lastOpened: existingProject.lastOpened,
			createdAt: existingProject.createdAt,
			color: existingProject.color,
			sortOrder: existingProject.sortOrder !== undefined ? existingProject.sortOrder + 1 : 1,
			iconPath: existingProject.iconPath ?? null,
			showExternalCliSessions: existingProject.showExternalCliSessions,
		}));
		this.projects = [optimisticProject, ...shiftedProjects];

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
	 * @returns ResultAsync indicating success or error
	 */
	updateProjectColor(path: string, color: string): ResultAsync<void, ProjectError> {
		return this.client.updateProjectColor(path, color).map((updatedProject) => {
			// Update the project in the projects list
			const existingIndex = this.projects.findIndex((p) => p.path === path);
			if (existingIndex >= 0) {
				this.projects = this.projects.map((p, i) => (i === existingIndex ? updatedProject : p));
				this.projectStorageFresh = true;
				this.writeCurrentProjectsToCache();
			}
		});
	}

	updateProjectIcon(path: string, iconPath: string | null): ResultAsync<void, ProjectError> {
		return this.client.updateProjectIcon(path, iconPath).map((updatedProject) => {
			const existingIndex = this.projects.findIndex((project) => project.path === path);
			if (existingIndex >= 0) {
				this.projects = this.projects.map((project, index) =>
					index === existingIndex ? updatedProject : project
				);
				this.projectStorageFresh = true;
				this.writeCurrentProjectsToCache();
			}
		});
	}

	listProjectImages(projectPath: string): ResultAsync<string[], ProjectError> {
		return this.client.listProjectImages(projectPath);
	}

	updateProjectShowExternalCliSessions(
		path: string,
		value: boolean
	): ResultAsync<void, ProjectError> {
		return this.client
			.updateProjectShowExternalCliSessions(path, value)
			.map(() => {
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
									iconPath: project.iconPath,
									showExternalCliSessions: value,
								}
							: project
					);
					this.projectStorageFresh = true;
					this.writeCurrentProjectsToCache();
				}
			})
			.andThen(() => {
				if (this.sessionStore === null) {
					return okAsync(undefined);
				}

				return this.sessionStore.loading
					.scanSessions([path])
					.mapErr(
						(error) =>
							new ProjectError(
								`Failed to refresh project sessions: ${error.message}`,
								"STORAGE_ERROR",
								error instanceof Error ? error : undefined
							)
					);
			});
	}

	/**
	 * Browse for a project icon and set it on the project.
	 * Opens native file picker for images, then updates the project icon if a file was selected.
	 *
	 * @param projectPath - The project path to update
	 * @returns ResultAsync containing void on success
	 */
	browseAndSetProjectIcon(projectPath: string): ResultAsync<void, ProjectError> {
		return this.client.browseProjectIcon().andThen((selectedFilePath) => {
			if (selectedFilePath === null) {
				return okAsync(undefined);
			}
			return this.updateProjectIcon(projectPath, selectedFilePath);
		});
	}

	triggerProjectIconBackfill(): void {
		void this.client
			.backfillProjectIcons()
			.andThen((updatedCount) => {
				if (updatedCount === 0) {
					return okAsync(undefined);
				}
				return this.loadProjectsFromStorage({
					showLoading: true,
					recordTrace: true,
					firstPageOnly: false,
					preferredPaths: [],
				});
			})
			.match(
				() => undefined,
				(error) => {
					console.warn("Project icon backfill failed:", error);
				}
			);
	}

	updateProjectOrder(orderedPaths: string[]): ResultAsync<void, ProjectError> {
		return this.client.updateProjectOrder(orderedPaths).map((updatedProjects) => {
			this.projects = updatedProjects;
			this.projectCount = updatedProjects.length;
			this.projectStorageFresh = true;
			this.writeCurrentProjectsToCache();
		});
	}

	/**
	 * Remove a project.
	 *
	 * @param path - The project path to remove
	 * @returns ResultAsync indicating success or error
	 */
	removeProject(path: string): ResultAsync<void, ProjectError> {
		return this.client.removeProject(path).andThen(() => {
			// Reload projects to get updated list
			return this.loadProjectsFromStorage({
				showLoading: true,
				recordTrace: true,
				firstPageOnly: false,
				preferredPaths: [],
			});
		});
	}

	/**
	 * Clear all projects.
	 *
	 * @returns ResultAsync indicating success or error
	 */
	clearProjects(): ResultAsync<void, ProjectError> {
		// Remove all projects sequentially
		let result: ResultAsync<void, ProjectError> = okAsync(undefined);

		for (const project of this.projects) {
			result = result.andThen(() => this.client.removeProject(project.path));
		}

		return result.andThen(() => {
			this.projects = [];
			this.projectCount = 0;
			this.projectStorageFresh = true;
			this.writeCurrentProjectsToCache();
			return okAsync(undefined);
		});
	}

	/**
	 * Browse for a project folder.
	 *
	 * @returns ResultAsync containing the selected project or null
	 */
	browseProject(): ResultAsync<Project | null, ProjectError> {
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
