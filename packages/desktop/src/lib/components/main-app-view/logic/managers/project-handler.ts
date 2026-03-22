/**
 * Project Handler - Manages project operations.
 *
 * Handles adding projects, browsing for projects, etc.
 */

import type { ResultAsync } from "neverthrow";
import type { ProjectManager } from "$lib/acp/logic/project-manager.svelte.js";
import { type MainAppViewError, ProjectOperationError } from "../../errors/main-app-view-error.js";
import type { MainAppViewState } from "../main-app-view-state.svelte.js";

/**
 * Handles project operations.
 */
export class ProjectHandler {
	/**
	 * Creates a new project handler.
	 *
	 * @param state - The main app view state
	 * @param projectManager - The project manager
	 */
	constructor(
		private readonly state: MainAppViewState,
		private readonly projectManager: ProjectManager
	) {}

	/**
	 * Imports a new project by browsing for it.
	 *
	 * Triggers session scanning automatically for the imported project.
	 *
	 * @returns ResultAsync indicating success or error
	 */
	addProject(): ResultAsync<void, MainAppViewError> {
		return this.projectManager
			.importProject()
			.map(() => undefined)
			.mapErr(
				(error) => new ProjectOperationError("import", error instanceof Error ? error : undefined)
			);
	}
}
