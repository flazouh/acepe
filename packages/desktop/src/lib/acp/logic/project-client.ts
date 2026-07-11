import { convertFileSrc } from "@tauri-apps/api/core";
import { Result, type ResultAsync } from "neverthrow";
import type { ProjectAcepeConfig, ProjectData } from "../../utils/tauri-client/types.js";
import { tauriClient } from "../../utils/tauri-client.js";
import { resolveProjectColor } from "@acepe/ui/colors";
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

const readProjectsHotCacheItem = Result.fromThrowable(
	(): string | null => {
		if (typeof localStorage === "undefined") {
			return null;
		}
		return localStorage.getItem(PROJECTS_HOT_CACHE_KEY);
	},
	() => null
);

const writeProjectsHotCacheItem = Result.fromThrowable(
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

const removeProjectsHotCacheItem = Result.fromThrowable(
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

const parseProjectsHotCache = Result.fromThrowable(
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
	const cachedItemResult = readProjectsHotCacheItem();
	const cachedItem = cachedItemResult.isOk() ? cachedItemResult.value : null;
	if (cachedItem === null) {
		return null;
	}

	const parsedResult = parseProjectsHotCache(cachedItem);
	if (parsedResult.isOk() && parsedResult.value !== null) {
		return parsedResult.value;
	}

	removeProjectsHotCacheItem();
	return null;
}

function writeProjectsHotCache(projects: readonly ProjectData[]): void {
	writeProjectsHotCacheItem(projects);
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

const buildProjectsHotCacheData = Result.fromThrowable(
	(projects: readonly Project[]): ProjectData[] =>
		projects.map((project) => projectToCachedProjectData(project)),
	() => null
);

/**
 * Client for communicating with Tauri backend for project operations.
 *
 * All methods use neverthrow ResultAsync for type-safe error handling.
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
	 * @returns ResultAsync containing array of projects
	 */
	getProjects(): ResultAsync<Project[], ProjectError> {
		return tauriClient.projects
			.getProjects()
			.mapErr(
				(error) =>
					new ProjectError(
						`Failed to get projects: ${error.message}`,
						"STORAGE_ERROR",
						error instanceof Error ? error : undefined
					)
			)
			.map((projects) => projects.map((project) => this.mapProject(project)));
	}

	getCachedProjects(): Project[] | null {
		const cachedProjects = readProjectsHotCache();
		if (cachedProjects === null) {
			return null;
		}
		return cachedProjects.map((project) => this.mapProject(project));
	}

	writeCachedProjects(projects: readonly Project[]): void {
		const cachedProjectsResult = buildProjectsHotCacheData(projects);
		if (cachedProjectsResult.isErr()) {
			return;
		}
		writeProjectsHotCache(cachedProjectsResult.value);
	}

	/**
	 * Get recent projects.
	 *
	 * @param limit - Maximum number of projects to return (default: 100)
	 * @returns ResultAsync containing array of projects
	 */
	getRecentProjects(limit = 50, preferredPaths: string[] = [], offset = 0): ResultAsync<Project[], ProjectError> {
		return tauriClient.projects
			.getRecentProjects(limit, preferredPaths, offset)
			.mapErr(
				(error) =>
					new ProjectError(
						`Failed to get recent projects: ${error.message}`,
						"STORAGE_ERROR",
						error instanceof Error ? error : undefined
					)
			)
			.map((projects) => projects.map((project) => this.mapProject(project)));
	}

	/**
	 * Get the total count of projects.
	 *
	 * @returns ResultAsync containing the project count
	 */
	getProjectCount(): ResultAsync<number, ProjectError> {
		return tauriClient.projects
			.getProjectCount()
			.mapErr(
				(error) =>
					new ProjectError(
						`Failed to get project count: ${error.message}`,
						"STORAGE_ERROR",
						error instanceof Error ? error : undefined
					)
			);
	}

	/**
	 * Import a project (add to workspace and trigger scanning).
	 *
	 * @param project - The project to import
	 * @returns ResultAsync containing the imported project on success
	 */
	importProject(project: Project): ResultAsync<Project, ProjectError> {
		return tauriClient.projects
			.importProject(project.path, project.name)
			.mapErr(
				(error) =>
					new ProjectError(
						`Failed to import project: ${error.message}`,
						"STORAGE_ERROR",
						error instanceof Error ? error : undefined
					)
			)
			.map((importedProject) => this.mapProject(importedProject));
	}

	/**
	 * Update a project's color.
	 *
	 * @param path - The project path
	 * @param color - The new color (color name like "red" or hex like "#FF5D5A")
	 * @returns ResultAsync containing the updated project
	 */
	updateProjectColor(path: string, color: string): ResultAsync<Project, ProjectError> {
		return tauriClient.projects
			.updateProjectColor(path, color)
			.mapErr(
				(error) =>
					new ProjectError(
						`Failed to update project color: ${error.message}`,
						"STORAGE_ERROR",
						error instanceof Error ? error : undefined
					)
			)
			.map((project) => this.mapProject(project));
	}

	updateProjectIcon(path: string, iconPath: string | null): ResultAsync<Project, ProjectError> {
		const normalizedIconPath = normalizeProjectIconUpdatePath(iconPath);
		return tauriClient.projects
			.updateProjectIcon(path, normalizedIconPath)
			.mapErr(
				(error) =>
					new ProjectError(
						`Failed to update project icon: ${error.message}`,
						"STORAGE_ERROR",
						error instanceof Error ? error : undefined
					)
			)
			.map((project) => this.mapProject(project));
	}

	getProjectAcepeConfig(path: string): ResultAsync<ProjectAcepeConfig, ProjectError> {
		return tauriClient.projects
			.getProjectAcepeConfig(path)
			.mapErr(
				(error) =>
					new ProjectError(
						`Failed to load project config: ${error.message}`,
						"STORAGE_ERROR",
						error instanceof Error ? error : undefined
					)
			);
	}

	saveProjectAcepeConfig(
		path: string,
		config: ProjectAcepeConfig
	): ResultAsync<ProjectAcepeConfig, ProjectError> {
		return tauriClient.projects
			.saveProjectAcepeConfig(path, config)
			.mapErr(
				(error) =>
					new ProjectError(
						`Failed to save project config: ${error.message}`,
						"STORAGE_ERROR",
						error instanceof Error ? error : undefined
					)
			);
	}

	updateProjectShowExternalCliSessions(
		path: string,
		value: boolean
	): ResultAsync<ProjectAcepeConfig, ProjectError> {
		return this.getProjectAcepeConfig(path).andThen((config) =>
			this.saveProjectAcepeConfig(path, {
				setupScript: config.setupScript,
				runScript: config.runScript,
				showExternalCliSessions: value,
			})
		);
	}

	listProjectImages(projectPath: string): ResultAsync<string[], ProjectError> {
		return tauriClient.projects
			.listProjectImages(projectPath)
			.mapErr(
				(error) =>
					new ProjectError(
						`Failed to list project images: ${error.message}`,
						"STORAGE_ERROR",
						error instanceof Error ? error : undefined
					)
			);
	}

	updateProjectOrder(orderedPaths: string[]): ResultAsync<Project[], ProjectError> {
		return tauriClient.projects
			.updateProjectOrder(orderedPaths)
			.mapErr(
				(error) =>
					new ProjectError(
						`Failed to update project order: ${error.message}`,
						"STORAGE_ERROR",
						error instanceof Error ? error : undefined
					)
			)
			.map((projects) => projects.map((project) => this.mapProject(project)));
	}

	/**
	 * Add a project to recent projects.
	 *
	 * @param project - The project to add
	 * @returns ResultAsync containing void on success
	 */
	addProject(project: Project): ResultAsync<void, ProjectError> {
		return tauriClient.projects
			.addProject(project.path, project.name)
			.mapErr(
				(error) =>
					new ProjectError(
						`Failed to add project: ${error.message}`,
						"STORAGE_ERROR",
						error instanceof Error ? error : undefined
					)
			);
	}

	backfillProjectIcons(): ResultAsync<number, ProjectError> {
		return tauriClient.projects
			.backfillProjectIcons()
			.mapErr(
				(error) =>
					new ProjectError(
						`Failed to backfill project icons: ${error.message}`,
						"STORAGE_ERROR",
						error instanceof Error ? error : undefined
					)
			);
	}

	/**
	 * Remove a project.
	 *
	 * @param path - The project path to remove
	 * @returns ResultAsync containing void on success
	 */
	removeProject(path: string): ResultAsync<void, ProjectError> {
		return tauriClient.projects
			.removeProject(path)
			.mapErr(
				(error) =>
					new ProjectError(
						`Failed to remove project: ${error.message}`,
						"STORAGE_ERROR",
						error instanceof Error ? error : undefined
					)
			);
	}

	/**
	 * Browse for a project icon image file.
	 *
	 * @returns ResultAsync containing the selected file path or null if cancelled
	 */
	browseProjectIcon(): ResultAsync<string | null, ProjectError> {
		return tauriClient.projects
			.browseProjectIcon()
			.mapErr(
				(error) =>
					new ProjectError(
						`Failed to browse project icon: ${error.message}`,
						"STORAGE_ERROR",
						error instanceof Error ? error : undefined
					)
			);
	}

	/**
	 * Browse for a project folder.
	 *
	 * @returns ResultAsync containing the selected project or null
	 */
	browseProject(): ResultAsync<Project | null, ProjectError> {
		return tauriClient.projects
			.browseProject()
			.mapErr(
				(error) =>
					new ProjectError(
						`Failed to browse project: ${error.message}`,
						"STORAGE_ERROR",
						error instanceof Error ? error : undefined
					)
			)
			.map((project) => (project ? this.mapProject(project) : null));
	}
}
