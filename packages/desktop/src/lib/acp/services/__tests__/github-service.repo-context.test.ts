import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";
import * as Effect from "effect/Effect";
import * as Result from "effect/Result";

import type { RepoContext } from "../../types/github-integration.js";

type GitHubServiceModule = typeof import("../github-service.js") & {
	clearRepoContextCache?: () => void;
	clearRepoContextInflight?: () => void;
};

let serviceModuleVersion = 0;
let serviceModule: GitHubServiceModule;

const repoContext: RepoContext = {
	owner: "flazouh",
	repo: "acepe",
	remoteUrl: "git@github.com:flazouh/acepe.git",
};
const invokeMock = mock((_command: string, _payload: { projectPath: string }) =>
	Promise.resolve(repoContext)
);

describe("GitHub Service - repo context cache", () => {
	beforeEach(async () => {
		invokeMock.mockClear();

		mock.module("../../../utils/tauri-commands.js", () => ({
			Commands: {
				github: {
					get_github_repo_context: "get_github_repo_context",
				},
			},
			invoke: invokeMock,
		}));

		serviceModuleVersion += 1;
		serviceModule = (await import(
			`../github-service.js?repo-context-test=${serviceModuleVersion}`
		)) as GitHubServiceModule;

		serviceModule.clearDiffCache();
		serviceModule.clearRepoContextCache?.();
		serviceModule.clearRepoContextInflight?.();
	});

	afterEach(() => {
		invokeMock.mockClear();
	});

	it("exports repo context cache reset hooks for deterministic tests", () => {
		expect(typeof serviceModule.clearRepoContextCache).toBe("function");
		expect(typeof serviceModule.clearRepoContextInflight).toBe("function");
	});

	it("refetches repo context after clearing the repo context cache", async () => {
		const first = await Effect.runPromise(Effect.result(serviceModule.getRepoContext("/repo")));
		const second = await Effect.runPromise(Effect.result(serviceModule.getRepoContext("/repo")));

		expect(Result.isSuccess(first)).toBe(true);
		expect(Result.isSuccess(second)).toBe(true);
		expect(invokeMock).toHaveBeenCalledTimes(1);

		if (!serviceModule.clearRepoContextCache) {
			throw new Error("Expected clearRepoContextCache export");
		}

		serviceModule.clearRepoContextCache();

		const third = await Effect.runPromise(Effect.result(serviceModule.getRepoContext("/repo")));
		expect(Result.isSuccess(third)).toBe(true);
		expect(invokeMock).toHaveBeenCalledTimes(2);
	});
});
