/**
 * Project Handler - Manages project operations.
 *
 * Handles adding projects, browsing for projects, etc.
 */

import * as Effect from "effect/Effect";
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
	 * @returns Effect indicating success or error
	 */
	addProject(): Effect.Effect<void, MainAppViewError> {
		return this.projectManager.importProject().pipe(
			Effect.map(() => undefined),
			Effect.mapError(
				(error) => new ProjectOperationError("import", error instanceof Error ? error : undefined)
			)
		);
	}
}
