import { invoke } from "@tauri-apps/api/core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as Effect from "effect/Effect";
import * as Result from "effect/Result";

import type { ProjectIndex } from "../../../../../services/converted-session-types.js";
import type { PanelStore } from "../../../../store/panel-store.svelte.js";
import type { SessionStore } from "../../../../store/session-store.svelte.js";
import { AgentInputState } from "../agent-input-state.svelte.js";

vi.mock("@tauri-apps/api/core", () => ({
	invoke: vi.fn(),
}));

vi.mock("@tauri-apps/api/event", () => ({
	listen: vi.fn(async () => () => {}),
}));

function createProjectIndex(projectPath: string, files: string[]): ProjectIndex {
	return {
		projectPath,
		files: files.map((path) => {
			const extensionIndex = path.lastIndexOf(".");
			const extension = extensionIndex >= 0 ? path.slice(extensionIndex + 1) : "";

			return {
				path,
				extension,
				lineCount: 1,
				gitStatus: null,
			};
		}),
		gitStatus: [],
		totalFiles: files.length,
		totalLines: files.length,
	};
}


async function runToResult<A, E>(effect: Effect.Effect<A, E>): Promise<Result.Result<A, E>> {
	return Effect.runPromise(Effect.result(effect));
}

describe("AgentInputState - file picker loading", () => {
	let state: AgentInputState;
	let projectPath: string | null;
	const mockedInvoke = invoke as unknown as ReturnType<typeof vi.fn>;

	beforeEach(() => {
		projectPath = "/tmp/project";
		mockedInvoke.mockReset();

		const mockStore: Partial<SessionStore> = {};
		const mockPanelStore: Partial<PanelStore> = {};
		state = new AgentInputState(
			mockStore as SessionStore,
			mockPanelStore as PanelStore,
			() => projectPath
		);
	});

	it("reloads files when the effective project path changes", async () => {
		mockedInvoke.mockImplementation((command, args) => {
			const nextProjectPath =
				typeof args === "object" && args && "projectPath" in args ? String(args.projectPath) : "";

			if (command !== "get_project_files") {
				return Promise.reject(new Error(`Unexpected command: ${command}`));
			}

			if (nextProjectPath === "/tmp/project") {
				return Promise.resolve(createProjectIndex(nextProjectPath, ["src/base.ts"]));
			}

			if (nextProjectPath === "/tmp/project/.worktrees/feature") {
				return Promise.resolve(createProjectIndex(nextProjectPath, ["src/worktree.ts"]));
			}

			return Promise.reject(new Error(`Unexpected project path: ${nextProjectPath}`));
		});

		const firstResult = await runToResult(state.loadProjectFiles("/tmp/project"));
		expect(Result.isSuccess(firstResult)).toBe(true);
		expect(state.availableFiles.map((file) => file.path)).toEqual(["src/base.ts"]);

		projectPath = "/tmp/project/.worktrees/feature";

		const secondResult = await runToResult(state.loadProjectFiles("/tmp/project/.worktrees/feature"));
		expect(Result.isSuccess(secondResult)).toBe(true);
		expect(mockedInvoke).toHaveBeenNthCalledWith(1, "get_project_files", {
			projectPath: "/tmp/project",
		});
		expect(mockedInvoke).toHaveBeenNthCalledWith(2, "get_project_files", {
			projectPath: "/tmp/project/.worktrees/feature",
		});
		expect(state.availableFiles.map((file) => file.path)).toEqual(["src/worktree.ts"]);
	});

	it("refreshes project files when the picker is reopened", async () => {
		let files = ["src/existing.ts"];

		mockedInvoke.mockImplementation((command, args) => {
			const nextProjectPath =
				typeof args === "object" && args && "projectPath" in args ? String(args.projectPath) : "";

			if (nextProjectPath !== "/tmp/project/.worktrees/feature") {
				return Promise.reject(new Error(`Unexpected project path: ${nextProjectPath}`));
			}

			if (command === "invalidate_project_files") {
				return Promise.resolve(undefined);
			}

			if (command === "get_project_files") {
				return Promise.resolve(createProjectIndex(nextProjectPath, files));
			}

			return Promise.reject(new Error(`Unexpected command: ${command}`));
		});

		const firstResult = await runToResult(state.loadProjectFiles("/tmp/project/.worktrees/feature"));
		expect(Result.isSuccess(firstResult)).toBe(true);
		expect(state.availableFiles.map((file) => file.path)).toEqual(["src/existing.ts"]);

		files = ["src/existing.ts", "src/new-file.ts"];

		const secondResult = await runToResult(state.loadProjectFiles("/tmp/project/.worktrees/feature", {
			refresh: true,
		}));
		expect(Result.isSuccess(secondResult)).toBe(true);
		expect(mockedInvoke).toHaveBeenNthCalledWith(1, "get_project_files", {
			projectPath: "/tmp/project/.worktrees/feature",
		});
		expect(mockedInvoke).toHaveBeenNthCalledWith(2, "invalidate_project_files", {
			projectPath: "/tmp/project/.worktrees/feature",
		});
		expect(mockedInvoke).toHaveBeenNthCalledWith(3, "get_project_files", {
			projectPath: "/tmp/project/.worktrees/feature",
		});
		expect(state.availableFiles.map((file) => file.path)).toEqual([
			"src/existing.ts",
			"src/new-file.ts",
		]);
	});
});
