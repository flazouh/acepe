import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { RpcGitCallError } from "@acepe/contracts";
import * as Effect from "effect/Effect";
import * as Result from "effect/Result";
import { setAppRpcClientForTest } from "../../../rpc/app-client.ts";
import { makeGitCallRpcClient } from "../../../rpc/fake-rpc-client.ts";
import {
	clearDiffCache,
	clearRepoContextCache,
	clearRepoContextInflight,
	fetchCommitDiff,
	fetchPrDiff,
	fetchWorkingFileDiff,
	getRepoContext,
	listPullRequests,
} from "../github-service.ts";

const repoContext = {
	owner: "flazouh",
	repo: "acepe",
	remoteUrl: "git@github.com:flazouh/acepe.git",
};

const sampleFile = {
	path: "src/main.ts",
	status: "modified" as const,
	additions: 3,
	deletions: 1,
	patch: "@@ -1 +1 @@\n-old\n+new\n",
};

beforeEach(() => {
	clearDiffCache();
	clearRepoContextCache();
	clearRepoContextInflight();
});

afterEach(() => {
	setAppRpcClientForTest(null);
});

describe("github-service over the Electrobun RPC client", () => {
	it("getRepoContext rides gitCall's git.repoContext op", () =>
		Effect.runPromise(
			Effect.gen(function* () {
				let requested: unknown = null;
				setAppRpcClientForTest(
					makeGitCallRpcClient((request) => {
						requested = request;
						return Effect.succeed({ op: "git.repoContext", context: repoContext });
					})
				);

				const result = yield* Effect.result(getRepoContext("/tmp/acepe"));

				expect(Result.isSuccess(result)).toBe(true);
				expect(requested).toEqual({ op: "git.repoContext", projectPath: "/tmp/acepe" });
				if (Result.isSuccess(result)) {
					expect(result.success).toEqual(repoContext);
				}
			})
		));

	it("fetchCommitDiff rides gitCall's git.commitDiff op", () =>
		Effect.runPromise(
			Effect.gen(function* () {
				let requested: unknown = null;
				setAppRpcClientForTest(
					makeGitCallRpcClient((request) => {
						requested = request;
						return Effect.succeed({
							op: "git.commitDiff",
							diff: {
								sha: "abcdef1234567890abcdef1234567890abcdef12",
								shortSha: "abcdef1",
								message: "fix: things",
								messageBody: "",
								author: "Alex",
								authorEmail: "alex@example.com",
								date: "2026-08-29T00:00:00Z",
								files: [sampleFile],
								repoContext,
							},
						});
					})
				);

				const result = yield* Effect.result(
					fetchCommitDiff("abcdef1234567890abcdef1234567890abcdef12", "/tmp/acepe")
				);

				expect(Result.isSuccess(result)).toBe(true);
				expect(requested).toEqual({
					op: "git.commitDiff",
					projectPath: "/tmp/acepe",
					sha: "abcdef1234567890abcdef1234567890abcdef12",
				});
				if (Result.isSuccess(result)) {
					expect(result.success.shortSha).toBe("abcdef1");
					expect(result.success.files).toEqual([sampleFile]);
				}
			})
		));

	it("fetchPrDiff rides gitCall's git.prDiff op", () =>
		Effect.runPromise(
			Effect.gen(function* () {
				let requested: unknown = null;
				setAppRpcClientForTest(
					makeGitCallRpcClient((request) => {
						requested = request;
						return Effect.succeed({
							op: "git.prDiff",
							diff: {
								pr: {
									number: 42,
									title: "Wire GitHub through RPC",
									author: "flazouh",
									state: "open" as const,
									description: "body",
								},
								files: [sampleFile],
								repoContext,
							},
						});
					})
				);

				const result = yield* Effect.result(fetchPrDiff("/tmp/acepe", "flazouh", "acepe", 42));

				expect(Result.isSuccess(result)).toBe(true);
				expect(requested).toEqual({
					op: "git.prDiff",
					projectPath: "/tmp/acepe",
					owner: "flazouh",
					repo: "acepe",
					prNumber: 42,
				});
				if (Result.isSuccess(result)) {
					expect(result.success.pr.number).toBe(42);
				}
			})
		));

	it("listPullRequests rides gitCall's git.listPullRequests op", () =>
		Effect.runPromise(
			Effect.gen(function* () {
				let requested: unknown = null;
				setAppRpcClientForTest(
					makeGitCallRpcClient((request) => {
						requested = request;
						return Effect.succeed({
							op: "git.listPullRequests",
							pullRequests: [
								{
									number: 7,
									title: "Some PR",
									author: "flazouh",
									state: "open" as const,
									headRef: "feat/x",
									baseRef: "main",
									updatedAt: "2026-08-29T00:00:00Z",
									additions: 10,
									deletions: 2,
									changedFiles: 3,
								},
							],
						});
					})
				);

				const result = yield* Effect.result(
					listPullRequests("/tmp/acepe", "flazouh", "acepe", "open")
				);

				expect(Result.isSuccess(result)).toBe(true);
				expect(requested).toEqual({
					op: "git.listPullRequests",
					projectPath: "/tmp/acepe",
					owner: "flazouh",
					repo: "acepe",
					state: "open",
					limit: 30,
				});
				if (Result.isSuccess(result)) {
					expect(result.success).toHaveLength(1);
					expect(result.success[0]?.number).toBe(7);
				}
			})
		));

	it("fetchWorkingFileDiff rides gitCall's git.workingFileDiff op", () =>
		Effect.runPromise(
			Effect.gen(function* () {
				let requested: unknown = null;
				setAppRpcClientForTest(
					makeGitCallRpcClient((request) => {
						requested = request;
						return Effect.succeed({ op: "git.workingFileDiff", diff: sampleFile });
					})
				);

				const result = yield* Effect.result(
					fetchWorkingFileDiff("/tmp/acepe", "src/main.ts", false, "modified", 3, 1)
				);

				expect(Result.isSuccess(result)).toBe(true);
				expect(requested).toEqual({
					op: "git.workingFileDiff",
					projectPath: "/tmp/acepe",
					filePath: "src/main.ts",
					staged: false,
					status: "modified",
					additions: 3,
					deletions: 1,
				});
				if (Result.isSuccess(result)) {
					expect(result.success.patch).toBe(sampleFile.patch);
				}
			})
		));

	it("maps a gh-not-found RPC failure onto the gh_not_found GitHubError", () =>
		Effect.runPromise(
			Effect.gen(function* () {
				setAppRpcClientForTest(
					makeGitCallRpcClient(() =>
						Effect.fail(
							new RpcGitCallError({
								op: "git.listPullRequests",
								detail: "gh: not found",
							})
						)
					)
				);

				const result = yield* Effect.result(
					listPullRequests("/tmp/acepe", "flazouh", "acepe", "open")
				);

				expect(Result.isFailure(result)).toBe(true);
				if (Result.isFailure(result)) {
					expect(result.failure.type).toBe("gh_not_found");
				}
			})
		));
});
