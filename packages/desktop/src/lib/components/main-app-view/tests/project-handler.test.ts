import { beforeEach, describe, expect, it, mock } from "bun:test";
import * as Effect from "effect/Effect";
import * as Result from "effect/Result";
import type { Project, ProjectManager } from "$lib/acp/logic/project-manager.svelte.js";
import { ProjectError } from "$lib/acp/logic/project-manager.svelte.js";

import type { MainAppViewState } from "../logic/main-app-view-state.svelte.js";

import { ProjectHandler } from "../logic/managers/project-handler.js";

describe("ProjectHandler", () => {
	let mockState: MainAppViewState;
	let mockProjectManager: ProjectManager;
	let handler: ProjectHandler;

	beforeEach(() => {
		mockState = {} as MainAppViewState;

		mockProjectManager = {
			recentProjects: [],
			selectedProject: null,
			importProject: mock(() => Effect.succeed(null)),
		} as unknown as ProjectManager;

		handler = new ProjectHandler(mockState, mockProjectManager);
	});

	describe("addProject", () => {
		it("should import project successfully", async () => {
			const project: Project = {
				path: "/test/project",
				name: "Test Project",
				createdAt: new Date(),
				color: "blue",
			};
			mockProjectManager.importProject = mock(() => Effect.succeed(project));

			const result = await Effect.runPromise(Effect.result(handler.addProject()));

			expect(Result.isSuccess(result)).toBe(true);
			expect(mockProjectManager.importProject).toHaveBeenCalled();
		});

		it("should return ok if user cancels file picker", async () => {
			mockProjectManager.importProject = mock(() => Effect.succeed(null));

			const result = await Effect.runPromise(Effect.result(handler.addProject()));

			expect(Result.isSuccess(result)).toBe(true);
		});

		it("should return error if import fails", async () => {
			mockProjectManager.importProject = mock(() =>
				Effect.fail(new ProjectError("Import failed", "STORAGE_ERROR"))
			);

			const result = await Effect.runPromise(Effect.result(handler.addProject()));

			expect(Result.isFailure(result)).toBe(true);
		});
	});
});
