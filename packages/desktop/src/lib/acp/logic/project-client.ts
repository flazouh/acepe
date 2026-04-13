import type { ResultAsync } from "neverthrow";
import { tauriClient } from "../../utils/tauri-client.js";
import { resolveProjectColor } from "../utils/colors.js";
import type { Project } from "./project-manager.svelte.js";
import { ProjectError } from "./project-manager.svelte.js";

/**
 * Client for communicating with Tauri backend for project operations.
 *
 * All methods use neverthrow ResultAsync for type-safe error handling.
 */
export class ProjectClient {
	private mapProject(project: {
		path: string;
		name: string;
		last_opened?: string;
		created_at: string;
		color: string;
		sort_order: number;
		icon_path?: string | null;
	}): Project {
		return {
			path: project.path,
			name: project.name,
			lastOpened: project.last_opened ? new Date(project.last_opened) : undefined,
			createdAt: new Date(project.created_at),
			color: resolveProjectColor(project.color),
			sortOrder: project.sort_order,
			iconPath: project.icon_path ?? null,
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
			.mapErr((e) => new ProjectError(`Failed to get projects: ${e}`, "STORAGE_ERROR"))
			.map((projects) => projects.map((project) => this.mapProject(project)));
	}

	/**
	 * Get recent projects.
	 *
	 * @param limit - Maximum number of projects to return (default: 100)
	 * @returns ResultAsync containing array of projects
	 */
	getRecentProjects(limit = 100): ResultAsync<Project[], ProjectError> {
		return tauriClient.projects
			.getRecentProjects(limit)
			.mapErr((e) => new ProjectError(`Failed to get recent projects: ${e}`, "STORAGE_ERROR"))
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
			.mapErr((e) => new ProjectError(`Failed to get project count: ${e}`, "STORAGE_ERROR"));
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
			.mapErr((e) => new ProjectError(`Failed to import project: ${e}`, "STORAGE_ERROR"))
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
			.mapErr((e) => new ProjectError(`Failed to update project color: ${e}`, "STORAGE_ERROR"))
			.map((project) => this.mapProject(project));
	}

	updateProjectIcon(path: string, iconPath: string | null): ResultAsync<Project, ProjectError> {
		return tauriClient.projects
			.updateProjectIcon(path, iconPath)
			.mapErr((e) => new ProjectError(`Failed to update project icon: ${e}`, "STORAGE_ERROR"))
			.map((project) => this.mapProject(project));
	}

	updateProjectOrder(orderedPaths: string[]): ResultAsync<Project[], ProjectError> {
		return tauriClient.projects
			.updateProjectOrder(orderedPaths)
			.mapErr((e) => new ProjectError(`Failed to update project order: ${e}`, "STORAGE_ERROR"))
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
			.mapErr((e) => new ProjectError(`Failed to add project: ${e}`, "STORAGE_ERROR"));
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
			.mapErr((e) => new ProjectError(`Failed to remove project: ${e}`, "STORAGE_ERROR"));
	}

	/**
	 * Browse for a project folder.
	 *
	 * @returns ResultAsync containing the selected project or null
	 */
	browseProject(): ResultAsync<Project | null, ProjectError> {
		return tauriClient.projects
			.browseProject()
			.mapErr((e) => new ProjectError(`Failed to browse project: ${e}`, "STORAGE_ERROR"))
			.map((project) => (project ? this.mapProject(project) : null));
	}
}
