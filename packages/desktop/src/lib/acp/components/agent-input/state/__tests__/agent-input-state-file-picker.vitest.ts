import * as Effect from "effect/Effect";
import * as Result from "effect/Result";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { ProjectIndex } from "../../../../../services/converted-session-types.js";
import type { PanelStore } from "../../../../store/panel-store.svelte.js";
import type { SessionStore } from "../../../../store/session-store.svelte.js";

const getProjectFiles = vi.fn();
const invalidateProjectFiles = vi.fn();

vi.mock("$lib/utils/backend-client/file-index.js", () => ({
	fileIndex: {
		getProjectFiles,
		invalidateProjectFiles,
	},
}));

import { AgentInputState } from "../agent-input-state.svelte.js";

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

	beforeEach(() => {
		projectPath = "/tmp/project";
		getProjectFiles.mockReset();
		invalidateProjectFiles.mockReset();

		const mockStore: Partial<SessionStore> = {};
		const mockPanelStore: Partial<PanelStore> = {};
		state = new AgentInputState(
			mockStore as SessionStore,
			mockPanelStore as PanelStore,
			() => projectPath
		);
	});

	it("reloads files when the effective project path changes", async () => {
		getProjectFiles.mockImplementation((nextProjectPath: string) => {
			if (nextProjectPath === "/tmp/project") {
				return Effect.succeed(createProjectIndex(nextProjectPath, ["src/base.ts"]));
			}
			if (nextProjectPath === "/tmp/project/.worktrees/feature") {
				return Effect.succeed(createProjectIndex(nextProjectPath, ["src/worktree.ts"]));
			}
			return Effect.fail(new Error(`Unexpected project path: ${nextProjectPath}`));
		});

		const firstResult = await runToResult(state.loadProjectFiles("/tmp/project"));
		expect(Result.isSuccess(firstResult)).toBe(true);
		expect(state.availableFiles.map((file) => file.path)).toEqual(["src/base.ts"]);

		projectPath = "/tmp/project/.worktrees/feature";

		const secondResult = await runToResult(
			state.loadProjectFiles("/tmp/project/.worktrees/feature")
		);
		expect(Result.isSuccess(secondResult)).toBe(true);
		expect(getProjectFiles).toHaveBeenNthCalledWith(1, "/tmp/project");
		expect(getProjectFiles).toHaveBeenNthCalledWith(2, "/tmp/project/.worktrees/feature");
		expect(state.availableFiles.map((file) => file.path)).toEqual(["src/worktree.ts"]);
	});

	it("refreshes project files when the picker is reopened", async () => {
		let files = ["src/existing.ts"];
		invalidateProjectFiles.mockImplementation(() => Effect.void);
		getProjectFiles.mockImplementation((nextProjectPath: string) => {
			if (nextProjectPath !== "/tmp/project/.worktrees/feature") {
				return Effect.fail(new Error(`Unexpected project path: ${nextProjectPath}`));
			}
			return Effect.succeed(createProjectIndex(nextProjectPath, files));
		});

		const firstResult = await runToResult(
			state.loadProjectFiles("/tmp/project/.worktrees/feature")
		);
		expect(Result.isSuccess(firstResult)).toBe(true);
		expect(state.availableFiles.map((file) => file.path)).toEqual(["src/existing.ts"]);

		files = ["src/existing.ts", "src/new-file.ts"];

		const secondResult = await runToResult(
			state.loadProjectFiles("/tmp/project/.worktrees/feature", {
				refresh: true,
			})
		);
		expect(Result.isSuccess(secondResult)).toBe(true);
		expect(getProjectFiles).toHaveBeenNthCalledWith(1, "/tmp/project/.worktrees/feature");
		expect(invalidateProjectFiles).toHaveBeenCalledWith("/tmp/project/.worktrees/feature");
		expect(getProjectFiles).toHaveBeenNthCalledWith(2, "/tmp/project/.worktrees/feature");
		expect(state.availableFiles.map((file) => file.path)).toEqual([
			"src/existing.ts",
			"src/new-file.ts",
		]);
	});
});
