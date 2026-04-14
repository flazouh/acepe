import { okAsync, ResultAsync } from "neverthrow";
import { SvelteDate } from "svelte/reactivity";
import type { SessionStore } from "$lib/acp/store/session-store.svelte.js";

import { resolveProjectColor } from "../utils/colors.js";
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
}

/**
 * Error types for project operations.
 */
export class ProjectError extends Error {
	constructor(
		message: string,
		public readonly code: ProjectErrorCode
	) {
		super(message);
		this.name = "ProjectError";
	}
}

export type ProjectErrorCode = "STORAGE_ERROR" | "INVALID_PATH" | "PROJECT_NOT_FOUND";

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
	private readonly client: ProjectClient;
	private sessionStore: SessionStore | null = null;

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
	 * Whether projects are currently loading.
	 */
	isLoading = $state(false);

	/**
	 * Current error, if any.
	 */
	error = $state<ProjectError | null>(null);

	constructor() {
		this.client = new ProjectClient();
		// Note: loadProjects() should be called explicitly after construction
		// Do NOT call it here as it modifies $state during initialization
		// which can cause infinite loops in Svelte 5
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
	 * Fetches both the project count and all projects.
	 *
	 * @returns ResultAsync containing void on success
	 */
	loadProjects(): ResultAsync<void, ProjectError> {
		this.isLoading = true;
		this.error = null;

		// Fetch both count and all projects in parallel
		return ResultAsync.combine([this.client.getProjectCount(), this.client.getProjects()])
			.map(([count, allProjects]) => {
				this.projectCount = count;
				this.projects = allProjects;
				this.isLoading = false;
			})
			.mapErr((error) => {
				this.error = error;
				this.isLoading = false;
				return error;
			});
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
					}));
					this.projects = [importedProject, ...shiftedProjects];
					// Update count only for new projects
					if (this.projectCount !== null) {
						this.projectCount = this.projectCount + 1;
					}
				} else {
					this.projects = this.projects.map((p, i) => (i === existingIndex ? importedProject : p));
				}

				// Trigger session scan for the imported project (fire and forget)
				if (this.sessionStore) {
					this.sessionStore.scanSessions([importedProject.path]).mapErr((error) => {
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
			return this.loadProjects();
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
		}));
		this.projects = [optimisticProject, ...shiftedProjects];

		// Update count
		this.projectCount = (this.projectCount ?? 0) + 1;
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
			}
		});
	}

	listProjectImages(projectPath: string): ResultAsync<string[], ProjectError> {
		return this.client.listProjectImages(projectPath);
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
				return this.loadProjects();
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
			return this.loadProjects();
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
