import { fromThrowable } from "@acepe/effect-result/fromThrowable";
import { resolveProjectColor } from "@acepe/ui/colors";
import { convertFileSrc } from "@tauri-apps/api/core";
import * as Effect from "effect/Effect";
import * as Result from "effect/Result";
import type { ProjectAcepeConfig, ProjectData } from "../../utils/tauri-client/types.js";
import { tauriClient } from "../../utils/tauri-client.js";
import type { Project } from "./project-manager.svelte.js";
import { ProjectError } from "./project-manager.svelte.js";

const PROJECTS_HOT_CACHE_KEY = "acepe.projects.hot_cache";
const PROJECTS_HOT_CACHE_VERSION = 1;

interface ProjectsHotCachePayload {
	readonly version: number;
	readonly projects: readonly ProjectData[];
}

/**
 * Converts a filesystem icon path to a Tauri asset:// URL.
 * Returns the value unchanged if it's falsy, or already a web/data/asset URL.
 */
export function convertIconPath(iconPath: string | null | undefined): string | null {
	if (!iconPath) {
		return iconPath === undefined ? null : iconPath;
	}

	if (
		iconPath.startsWith("http://") ||
		iconPath.startsWith("https://") ||
		iconPath.startsWith("data:") ||
		iconPath.startsWith("asset://")
	) {
		return iconPath;
	}

	return convertFileSrc(iconPath);
}

export function normalizeProjectIconUpdatePath(iconPath: string | null): string | null {
	return iconPath === "" ? null : iconPath;
}

const readProjectsHotCacheItem = fromThrowable(
	(): string | null => {
		if (typeof localStorage === "undefined") {
			return null;
		}
		return localStorage.getItem(PROJECTS_HOT_CACHE_KEY);
	},
	() => null
);

const writeProjectsHotCacheItem = fromThrowable(
	(projects: readonly ProjectData[]): void => {
		if (typeof localStorage === "undefined") {
			return;
		}
		const payload: ProjectsHotCachePayload = {
			version: PROJECTS_HOT_CACHE_VERSION,
			projects,
		};
		localStorage.setItem(PROJECTS_HOT_CACHE_KEY, JSON.stringify(payload));
	},
	() => undefined
);

const removeProjectsHotCacheItem = fromThrowable(
	(): void => {
		if (typeof localStorage === "undefined") {
			return;
		}
		localStorage.removeItem(PROJECTS_HOT_CACHE_KEY);
	},
	() => undefined
);

function normalizeOptionalString(value: string | null | undefined): string | null | undefined {
	if (value === null) {
		return null;
	}
	return typeof value === "string" ? value : undefined;
}

function normalizeOptionalDateString(value: string | null | undefined): string | undefined {
	return typeof value === "string" ? value : undefined;
}

function normalizeOptionalBoolean(value: boolean | undefined): boolean | undefined {
	return typeof value === "boolean" ? value : undefined;
}

function normalizeCachedProject(project: ProjectData): ProjectData | null {
	if (
		typeof project.path !== "string" ||
		typeof project.name !== "string" ||
		typeof project.created_at !== "string" ||
		typeof project.color !== "string" ||
		typeof project.sort_order !== "number"
	) {
		return null;
	}

	return {
		path: project.path,
		name: project.name,
		last_opened: normalizeOptionalDateString(project.last_opened),
		created_at: project.created_at,
		color: project.color,
		sort_order: project.sort_order,
		icon_path: normalizeOptionalString(project.icon_path),
		show_external_cli_sessions: normalizeOptionalBoolean(project.show_external_cli_sessions),
	};
}

function normalizeCachedProjects(projects: readonly ProjectData[]): ProjectData[] | null {
	const normalizedProjects: ProjectData[] = [];
	for (const project of projects) {
		const normalizedProject = normalizeCachedProject(project);
		if (normalizedProject === null) {
			return null;
		}
		normalizedProjects.push(normalizedProject);
	}
	return normalizedProjects;
}

const parseProjectsHotCache = fromThrowable(
	(stored: string): ProjectData[] | null => {
		const parsed = JSON.parse(stored) as ProjectsHotCachePayload;
		if (
			!parsed ||
			parsed.version !== PROJECTS_HOT_CACHE_VERSION ||
			!Array.isArray(parsed.projects)
		) {
			return null;
		}
		return normalizeCachedProjects(parsed.projects);
	},
	() => null
);

function readProjectsHotCache(): ProjectData[] | null {
	const cachedItemResult = Effect.runSync(Effect.result(readProjectsHotCacheItem()));
	const cachedItem = Result.isSuccess(cachedItemResult) ? cachedItemResult.success : null;
	if (cachedItem === null) {
		return null;
	}

	const parsedResult = Effect.runSync(Effect.result(parseProjectsHotCache(cachedItem)));
	if (Result.isSuccess(parsedResult) && parsedResult.success !== null) {
		return parsedResult.success;
	}

	void Effect.runSync(Effect.result(removeProjectsHotCacheItem()));
	return null;
}

function writeProjectsHotCache(projects: readonly ProjectData[]): void {
	void Effect.runSync(Effect.result(writeProjectsHotCacheItem(projects)));
}

function projectDateToStorageString(date: Date): string {
	return date.toISOString();
}

function projectToCachedProjectData(project: Project): ProjectData {
	return {
		path: project.path,
		name: project.name,
		last_opened: project.lastOpened ? projectDateToStorageString(project.lastOpened) : undefined,
		created_at: projectDateToStorageString(project.createdAt),
		color: project.color,
		sort_order: project.sortOrder ?? 0,
		icon_path: project.iconPath ?? null,
		show_external_cli_sessions: project.showExternalCliSessions,
	};
}

const buildProjectsHotCacheData = fromThrowable(
	(projects: readonly Project[]): ProjectData[] =>
		projects.map((project) => projectToCachedProjectData(project)),
	() => null
);

/**
 * Client for communicating with Tauri backend for project operations.
 *
 * All methods use Effect for type-safe error handling.
 */
export class ProjectClient {
	private mapProject(project: ProjectData): Project {
		return {
			path: project.path,
			name: project.name,
			lastOpened: project.last_opened ? new Date(project.last_opened) : undefined,
			createdAt: new Date(project.created_at),
			color: resolveProjectColor(project.color),
			sortOrder: project.sort_order,
			iconPath: convertIconPath(project.icon_path ?? null),
			showExternalCliSessions: project.show_external_cli_sessions,
		};
	}

	/**
	 * Get all projects.
	 *
	 * @returns Effect containing array of projects
	 */
	getProjects(): Effect.Effect<Project[], ProjectError> {
		return tauriClient.projects.getProjects().pipe(
			Effect.mapError(
				(error) =>
					new ProjectError(
						`Failed to get projects: ${error.message}`,
						"STORAGE_ERROR",
						error instanceof Error ? error : undefined
					)
			),
			Effect.map((projects) => projects.map((project) => this.mapProject(project)))
		);
	}

	getCachedProjects(): Project[] | null {
		const cachedProjects = readProjectsHotCache();
		if (cachedProjects === null) {
			return null;
		}
		return cachedProjects.map((project) => this.mapProject(project));
	}

	writeCachedProjects(projects: readonly Project[]): void {
		const cachedProjectsResult = Effect.runSync(Effect.result(buildProjectsHotCacheData(projects)));
		if (Result.isFailure(cachedProjectsResult)) {
			return;
		}
		writeProjectsHotCache(cachedProjectsResult.success);
	}

	/**
	 * Get recent projects.
	 *
	 * @param limit - Maximum number of projects to return (default: 100)
	 * @returns Effect containing array of projects
	 */
	getRecentProjects(
		limit = 50,
		preferredPaths: string[] = [],
		offset = 0
	): Effect.Effect<Project[], ProjectError> {
		return tauriClient.projects.getRecentProjects(limit, preferredPaths, offset).pipe(
			Effect.mapError(
				(error) =>
					new ProjectError(
						`Failed to get recent projects: ${error.message}`,
						"STORAGE_ERROR",
						error instanceof Error ? error : undefined
					)
			),
			Effect.map((projects) => projects.map((project) => this.mapProject(project)))
		);
	}

	/**
	 * Get the total count of projects.
	 *
	 * @returns Effect containing the project count
	 */
	getProjectCount(): Effect.Effect<number, ProjectError> {
		return tauriClient.projects
			.getProjectCount()
			.pipe(
				Effect.mapError(
					(error) =>
						new ProjectError(
							`Failed to get project count: ${error.message}`,
							"STORAGE_ERROR",
							error instanceof Error ? error : undefined
						)
				)
			);
	}

	/**
	 * Import a project (add to workspace and trigger scanning).
	 *
	 * @param project - The project to import
	 * @returns Effect containing the imported project on success
	 */
	importProject(project: Project): Effect.Effect<Project, ProjectError> {
		return tauriClient.projects.importProject(project.path, project.name).pipe(
			Effect.mapError(
				(error) =>
					new ProjectError(
						`Failed to import project: ${error.message}`,
						"STORAGE_ERROR",
						error instanceof Error ? error : undefined
					)
			),
			Effect.map((importedProject) => this.mapProject(importedProject))
		);
	}

	/**
	 * Update a project's color.
	 *
	 * @param path - The project path
	 * @param color - The new color (color name like "red" or hex like "#FF5D5A")
	 * @returns Effect containing the updated project
	 */
	updateProjectColor(path: string, color: string): Effect.Effect<Project, ProjectError> {
		return tauriClient.projects.updateProjectColor(path, color).pipe(
			Effect.mapError(
				(error) =>
					new ProjectError(
						`Failed to update project color: ${error.message}`,
						"STORAGE_ERROR",
						error instanceof Error ? error : undefined
					)
			),
			Effect.map((project) => this.mapProject(project))
		);
	}

	updateProjectIcon(path: string, iconPath: string | null): Effect.Effect<Project, ProjectError> {
		const normalizedIconPath = normalizeProjectIconUpdatePath(iconPath);
		return tauriClient.projects.updateProjectIcon(path, normalizedIconPath).pipe(
			Effect.mapError(
				(error) =>
					new ProjectError(
						`Failed to update project icon: ${error.message}`,
						"STORAGE_ERROR",
						error instanceof Error ? error : undefined
					)
			),
			Effect.map((project) => this.mapProject(project))
		);
	}

	getProjectAcepeConfig(path: string): Effect.Effect<ProjectAcepeConfig, ProjectError> {
		return tauriClient.projects
			.getProjectAcepeConfig(path)
			.pipe(
				Effect.mapError(
					(error) =>
						new ProjectError(
							`Failed to load project config: ${error.message}`,
							"STORAGE_ERROR",
							error instanceof Error ? error : undefined
						)
				)
			);
	}

	saveProjectAcepeConfig(
		path: string,
		config: ProjectAcepeConfig
	): Effect.Effect<ProjectAcepeConfig, ProjectError> {
		return tauriClient.projects
			.saveProjectAcepeConfig(path, config)
			.pipe(
				Effect.mapError(
					(error) =>
						new ProjectError(
							`Failed to save project config: ${error.message}`,
							"STORAGE_ERROR",
							error instanceof Error ? error : undefined
						)
				)
			);
	}

	updateProjectShowExternalCliSessions(
		path: string,
		value: boolean
	): Effect.Effect<ProjectAcepeConfig, ProjectError> {
		return this.getProjectAcepeConfig(path).pipe(
			Effect.flatMap((config) =>
				this.saveProjectAcepeConfig(path, {
					setupScript: config.setupScript,
					runScript: config.runScript,
					showExternalCliSessions: value,
				})
			)
		);
	}

	listProjectImages(projectPath: string): Effect.Effect<string[], ProjectError> {
		return tauriClient.projects
			.listProjectImages(projectPath)
			.pipe(
				Effect.mapError(
					(error) =>
						new ProjectError(
							`Failed to list project images: ${error.message}`,
							"STORAGE_ERROR",
							error instanceof Error ? error : undefined
						)
				)
			);
	}

	updateProjectOrder(orderedPaths: string[]): Effect.Effect<Project[], ProjectError> {
		return tauriClient.projects.updateProjectOrder(orderedPaths).pipe(
			Effect.mapError(
				(error) =>
					new ProjectError(
						`Failed to update project order: ${error.message}`,
						"STORAGE_ERROR",
						error instanceof Error ? error : undefined
					)
			),
			Effect.map((projects) => projects.map((project) => this.mapProject(project)))
		);
	}

	/**
	 * Add a project to recent projects.
	 *
	 * @param project - The project to add
	 * @returns Effect containing void on success
	 */
	addProject(project: Project): Effect.Effect<void, ProjectError> {
		return tauriClient.projects
			.addProject(project.path, project.name)
			.pipe(
				Effect.mapError(
					(error) =>
						new ProjectError(
							`Failed to add project: ${error.message}`,
							"STORAGE_ERROR",
							error instanceof Error ? error : undefined
						)
				)
			);
	}

	backfillProjectIcons(): Effect.Effect<number, ProjectError> {
		return tauriClient.projects
			.backfillProjectIcons()
			.pipe(
				Effect.mapError(
					(error) =>
						new ProjectError(
							`Failed to backfill project icons: ${error.message}`,
							"STORAGE_ERROR",
							error instanceof Error ? error : undefined
						)
				)
			);
	}

	/**
	 * Remove a project.
	 *
	 * @param path - The project path to remove
	 * @returns Effect containing void on success
	 */
	removeProject(path: string): Effect.Effect<void, ProjectError> {
		return tauriClient.projects
			.removeProject(path)
			.pipe(
				Effect.mapError(
					(error) =>
						new ProjectError(
							`Failed to remove project: ${error.message}`,
							"STORAGE_ERROR",
							error instanceof Error ? error : undefined
						)
				)
			);
	}

	/**
	 * Browse for a project icon image file.
	 *
	 * @returns Effect containing the selected file path or null if cancelled
	 */
	browseProjectIcon(): Effect.Effect<string | null, ProjectError> {
		return tauriClient.projects
			.browseProjectIcon()
			.pipe(
				Effect.mapError(
					(error) =>
						new ProjectError(
							`Failed to browse project icon: ${error.message}`,
							"STORAGE_ERROR",
							error instanceof Error ? error : undefined
						)
				)
			);
	}

	/**
	 * Browse for a project folder.
	 *
	 * @returns Effect containing the selected project or null
	 */
	browseProject(): Effect.Effect<Project | null, ProjectError> {
		return tauriClient.projects.browseProject().pipe(
			Effect.mapError(
				(error) =>
					new ProjectError(
						`Failed to browse project: ${error.message}`,
						"STORAGE_ERROR",
						error instanceof Error ? error : undefined
					)
			),
			Effect.map((project) => (project ? this.mapProject(project) : null))
		);
	}
}
