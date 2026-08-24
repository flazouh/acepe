import { afterEach, describe, expect, it } from "bun:test";
import {
	SessionId,
	emptyRpcSessionSnapshot,
	type GitCallRequest,
	type GitCallResult,
	type RpcClient,
	type RpcClientError,
} from "@acepe/contracts";
import * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Result from "effect/Result";
import * as Stream from "effect/Stream";

import { setAppRpcClientForTest } from "../../rpc/app-client.ts";
import { git } from "./git.ts";

const unusedIndex = {
	projectPath: "/tmp/p",
	files: [],
	gitStatus: [],
	totalFiles: 0,
	totalLines: 0,
};

const makeClient = (
	gitCallImpl: (request: GitCallRequest) => Effect.Effect<GitCallResult, RpcClientError>
): RpcClient => ({
	dispatch: () => Effect.succeed({ sequence: 1 }),
	snapshot: () => Effect.succeed(emptyRpcSessionSnapshot(0)),
	getProjectIndex: () => Effect.succeed(unusedIndex),
	invalidateProjectIndex: () => Effect.void,
	readTextFile: () => Effect.succeed(""),
	writeTextFile: () => Effect.void,
	getDefaultShell: () => Effect.succeed("/bin/zsh"),
	gitCall: gitCallImpl,
	getProviderAccountUsage: () => Effect.succeed([]),
	listProviderSessions: () => Effect.succeed([]),
	listProviderProjects: () => Effect.succeed([]),
	importProviderSession: () => Effect.succeed({ sessionId: SessionId.make("session-1"), imported: false }),
	events: () => Stream.empty,
});

afterEach(() => {
	setAppRpcClientForTest(null);
});

describe("git tauri client", () => {
	it("init sends the projectPath and resolves to void", () =>
		Effect.runPromise(
			Effect.gen(function* () {
				let requested: unknown = null;
				setAppRpcClientForTest(
					makeClient((request) => {
						requested = request;
						return Effect.succeed({ op: "git.init" });
					})
				);

				const result = yield* Effect.result(git.init("/tmp/acepe"));

				expect(Result.isSuccess(result)).toBe(true);
				expect(requested).toEqual({ op: "git.init", projectPath: "/tmp/acepe" });
			})
		));

	it("isRepo unwraps the tagged-union result", () =>
		Effect.runPromise(
			Effect.gen(function* () {
				setAppRpcClientForTest(
					makeClient(() => Effect.succeed({ op: "git.isRepo", isRepo: true }))
				);

				const result = yield* Effect.result(git.isRepo("/tmp/acepe"));

				expect(Result.isSuccess(result)).toBe(true);
				expect(Result.getOrThrow(result)).toBe(true);
			})
		));

	it("currentBranch returns the branch name", () =>
		Effect.runPromise(
			Effect.gen(function* () {
				setAppRpcClientForTest(
					makeClient(() => Effect.succeed({ op: "git.currentBranch", branch: "main" }))
				);

				const result = yield* Effect.result(git.currentBranch("/tmp/acepe"));

				expect(Result.getOrThrow(result)).toBe("main");
			})
		));

	it("listBranches returns the branch array", () =>
		Effect.runPromise(
			Effect.gen(function* () {
				setAppRpcClientForTest(
					makeClient(() =>
						Effect.succeed({ op: "git.listBranches", branches: ["main", "feature/x"] })
					)
				);

				const result = yield* Effect.result(git.listBranches("/tmp/acepe"));

				expect(Result.getOrThrow(result)).toEqual(["main", "feature/x"]);
			})
		));

	it("checkoutBranch sends the create flag and returns the branch", () =>
		Effect.runPromise(
			Effect.gen(function* () {
				let requested: unknown = null;
				setAppRpcClientForTest(
					makeClient((request) => {
						requested = request;
						return Effect.succeed({ op: "git.checkoutBranch", branch: "feature/x" });
					})
				);

				const result = yield* Effect.result(git.checkoutBranch("/tmp/acepe", "feature/x", true));

				expect(Result.getOrThrow(result)).toBe("feature/x");
				expect(requested).toEqual({
					op: "git.checkoutBranch",
					projectPath: "/tmp/acepe",
					branch: "feature/x",
					create: true,
				});
			})
		));

	it("hasUncommittedChanges returns the boolean", () =>
		Effect.runPromise(
			Effect.gen(function* () {
				setAppRpcClientForTest(
					makeClient(() =>
						Effect.succeed({ op: "git.hasUncommittedChanges", hasUncommittedChanges: true })
					)
				);

				const result = yield* Effect.result(git.hasUncommittedChanges("/tmp/acepe"));

				expect(Result.getOrThrow(result)).toBe(true);
			})
		));

	it("panelStatus returns the file status array", () =>
		Effect.runPromise(
			Effect.gen(function* () {
				const files = [
					{
						path: "a.ts",
						indexStatus: "M",
						worktreeStatus: null,
						indexInsertions: 1,
						indexDeletions: 0,
						worktreeInsertions: 0,
						worktreeDeletions: 0,
					},
				];
				setAppRpcClientForTest(makeClient(() => Effect.succeed({ op: "git.panelStatus", files })));

				const result = yield* Effect.result(git.panelStatus("/tmp/acepe"));

				expect(Result.getOrThrow(result)).toEqual(files);
			})
		));

	it("stageFiles sends the file list and resolves to void", () =>
		Effect.runPromise(
			Effect.gen(function* () {
				let requested: unknown = null;
				setAppRpcClientForTest(
					makeClient((request) => {
						requested = request;
						return Effect.succeed({ op: "git.stageFiles" });
					})
				);

				const result = yield* Effect.result(git.stageFiles("/tmp/acepe", ["a.ts", "b.ts"]));

				expect(Result.isSuccess(result)).toBe(true);
				expect(requested).toEqual({
					op: "git.stageFiles",
					projectPath: "/tmp/acepe",
					files: ["a.ts", "b.ts"],
				});
			})
		));

	it("unstageFiles sends the file list and resolves to void", () =>
		Effect.runPromise(
			Effect.gen(function* () {
				let requested: unknown = null;
				setAppRpcClientForTest(
					makeClient((request) => {
						requested = request;
						return Effect.succeed({ op: "git.unstageFiles" });
					})
				);

				const result = yield* Effect.result(git.unstageFiles("/tmp/acepe", ["a.ts"]));

				expect(Result.isSuccess(result)).toBe(true);
				expect(requested).toEqual({
					op: "git.unstageFiles",
					projectPath: "/tmp/acepe",
					files: ["a.ts"],
				});
			})
		));

	it("stageAll resolves to void", () =>
		Effect.runPromise(
			Effect.gen(function* () {
				let requested: unknown = null;
				setAppRpcClientForTest(
					makeClient((request) => {
						requested = request;
						return Effect.succeed({ op: "git.stageAll" });
					})
				);

				const result = yield* Effect.result(git.stageAll("/tmp/acepe"));

				expect(Result.isSuccess(result)).toBe(true);
				expect(requested).toEqual({ op: "git.stageAll", projectPath: "/tmp/acepe" });
			})
		));

	it("discardChanges sends the file list and resolves to void", () =>
		Effect.runPromise(
			Effect.gen(function* () {
				let requested: unknown = null;
				setAppRpcClientForTest(
					makeClient((request) => {
						requested = request;
						return Effect.succeed({ op: "git.discardChanges" });
					})
				);

				const result = yield* Effect.result(git.discardChanges("/tmp/acepe", ["a.ts"]));

				expect(Result.isSuccess(result)).toBe(true);
				expect(requested).toEqual({
					op: "git.discardChanges",
					projectPath: "/tmp/acepe",
					files: ["a.ts"],
				});
			})
		));

	it("commit returns the sha and shortSha", () =>
		Effect.runPromise(
			Effect.gen(function* () {
				let requested: unknown = null;
				setAppRpcClientForTest(
					makeClient((request) => {
						requested = request;
						return Effect.succeed({
							op: "git.commit",
							sha: "abc123",
							shortSha: "abc123".slice(0, 7),
						});
					})
				);

				const result = yield* Effect.result(git.commit("/tmp/acepe", "message"));

				expect(Result.getOrThrow(result)).toEqual({ sha: "abc123", shortSha: "abc123" });
				expect(requested).toEqual({
					op: "git.commit",
					projectPath: "/tmp/acepe",
					message: "message",
				});
			})
		));

	it("log sends the limit and returns the entries", () =>
		Effect.runPromise(
			Effect.gen(function* () {
				const entries = [
					{ sha: "abc123", shortSha: "abc1234", message: "msg", author: "a", date: "2026-08-24" },
				];
				let requested: unknown = null;
				setAppRpcClientForTest(
					makeClient((request) => {
						requested = request;
						return Effect.succeed({ op: "git.log", entries });
					})
				);

				const result = yield* Effect.result(git.log("/tmp/acepe", 10));

				expect(Result.getOrThrow(result)).toEqual(entries);
				expect(requested).toEqual({ op: "git.log", projectPath: "/tmp/acepe", limit: 10 });
			})
		));

	it("push sends the projectPath and resolves to void", () =>
		Effect.runPromise(
			Effect.gen(function* () {
				let requested: unknown = null;
				setAppRpcClientForTest(
					makeClient((request) => {
						requested = request;
						return Effect.succeed({ op: "git.push" });
					})
				);

				const result = yield* Effect.result(git.push("/tmp/acepe"));

				expect(Result.isSuccess(result)).toBe(true);
				expect(requested).toEqual({ op: "git.push", projectPath: "/tmp/acepe" });
			})
		));

	it("pull sends the projectPath and resolves to void", () =>
		Effect.runPromise(
			Effect.gen(function* () {
				let requested: unknown = null;
				setAppRpcClientForTest(
					makeClient((request) => {
						requested = request;
						return Effect.succeed({ op: "git.pull" });
					})
				);

				const result = yield* Effect.result(git.pull("/tmp/acepe"));

				expect(Result.isSuccess(result)).toBe(true);
				expect(requested).toEqual({ op: "git.pull", projectPath: "/tmp/acepe" });
			})
		));

	it("fetch sends the projectPath and resolves to void", () =>
		Effect.runPromise(
			Effect.gen(function* () {
				let requested: unknown = null;
				setAppRpcClientForTest(
					makeClient((request) => {
						requested = request;
						return Effect.succeed({ op: "git.fetch" });
					})
				);

				const result = yield* Effect.result(git.fetch("/tmp/acepe"));

				expect(Result.isSuccess(result)).toBe(true);
				expect(requested).toEqual({ op: "git.fetch", projectPath: "/tmp/acepe" });
			})
		));

	it("remoteStatus returns the ahead/behind/remote/trackingBranch fields", () =>
		Effect.runPromise(
			Effect.gen(function* () {
				setAppRpcClientForTest(
					makeClient(() =>
						Effect.succeed({
							op: "git.remoteStatus",
							ahead: 2,
							behind: 1,
							remote: "origin",
							trackingBranch: "origin/main",
						})
					)
				);

				const result = yield* Effect.result(git.remoteStatus("/tmp/acepe"));

				expect(Result.getOrThrow(result)).toEqual({
					ahead: 2,
					behind: 1,
					remote: "origin",
					trackingBranch: "origin/main",
				});
			})
		));

	it("stashList returns the stash entries", () =>
		Effect.runPromise(
			Effect.gen(function* () {
				const entries = [{ index: 0, message: "WIP on main", date: "2 hours ago" }];
				setAppRpcClientForTest(makeClient(() => Effect.succeed({ op: "git.stashList", entries })));

				const result = yield* Effect.result(git.stashList("/tmp/acepe"));

				expect(Result.getOrThrow(result)).toEqual(entries);
			})
		));

	it("stashPop sends the projectPath and index", () =>
		Effect.runPromise(
			Effect.gen(function* () {
				let requested: unknown = null;
				setAppRpcClientForTest(
					makeClient((request) => {
						requested = request;
						return Effect.succeed({ op: "git.stashPop" });
					})
				);

				const result = yield* Effect.result(git.stashPop("/tmp/acepe", 2));

				expect(Result.isSuccess(result)).toBe(true);
				expect(requested).toEqual({ op: "git.stashPop", projectPath: "/tmp/acepe", index: 2 });
			})
		));

	it("stashDrop sends the projectPath and index", () =>
		Effect.runPromise(
			Effect.gen(function* () {
				let requested: unknown = null;
				setAppRpcClientForTest(
					makeClient((request) => {
						requested = request;
						return Effect.succeed({ op: "git.stashDrop" });
					})
				);

				const result = yield* Effect.result(git.stashDrop("/tmp/acepe", 1));

				expect(Result.isSuccess(result)).toBe(true);
				expect(requested).toEqual({ op: "git.stashDrop", projectPath: "/tmp/acepe", index: 1 });
			})
		));

	it("prepareWorktreeSessionLaunch sends the agentId and returns the launch", () =>
		Effect.runPromise(
			Effect.gen(function* () {
				let requested: unknown = null;
				const launch = {
					launchToken: "token-1",
					sequenceId: 1,
					worktree: {
						name: "clever-falcon",
						branch: "clever-falcon",
						directory: "/tmp/acepe-wt/clever-falcon",
						origin: "acepe" as const,
					},
				};
				setAppRpcClientForTest(
					makeClient((request) => {
						requested = request;
						return Effect.succeed({ op: "git.prepareWorktreeSessionLaunch", launch });
					})
				);

				const result = yield* Effect.result(
					git.prepareWorktreeSessionLaunch("/tmp/acepe", "agent-1")
				);

				expect(Result.getOrThrow(result)).toEqual(launch);
				expect(requested).toEqual({
					op: "git.prepareWorktreeSessionLaunch",
					projectPath: "/tmp/acepe",
					agentId: "agent-1",
				});
			})
		));

	it("discardPreparedWorktreeSessionLaunch sends the launchToken and removeWorktree flag", () =>
		Effect.runPromise(
			Effect.gen(function* () {
				let requested: unknown = null;
				setAppRpcClientForTest(
					makeClient((request) => {
						requested = request;
						return Effect.succeed({ op: "git.discardPreparedWorktreeSessionLaunch" });
					})
				);

				const result = yield* Effect.result(
					git.discardPreparedWorktreeSessionLaunch("token-1", true)
				);

				expect(Result.isSuccess(result)).toBe(true);
				expect(requested).toEqual({
					op: "git.discardPreparedWorktreeSessionLaunch",
					launchToken: "token-1",
					removeWorktree: true,
				});
			})
		));

	it("worktreeRemove sends the worktreePath and force flag", () =>
		Effect.runPromise(
			Effect.gen(function* () {
				let requested: unknown = null;
				setAppRpcClientForTest(
					makeClient((request) => {
						requested = request;
						return Effect.succeed({ op: "git.worktreeRemove" });
					})
				);

				const result = yield* Effect.result(
					git.worktreeRemove("/tmp/acepe-wt/clever-falcon", true)
				);

				expect(Result.isSuccess(result)).toBe(true);
				expect(requested).toEqual({
					op: "git.worktreeRemove",
					worktreePath: "/tmp/acepe-wt/clever-falcon",
					force: true,
				});
			})
		));

	it("worktreeList returns the worktree array", () =>
		Effect.runPromise(
			Effect.gen(function* () {
				const worktrees = [
					{
						name: "clever-falcon",
						branch: "clever-falcon",
						directory: "/tmp/acepe-wt/clever-falcon",
						origin: "acepe" as const,
					},
				];
				setAppRpcClientForTest(
					makeClient(() => Effect.succeed({ op: "git.worktreeList", worktrees }))
				);

				const result = yield* Effect.result(git.worktreeList("/tmp/acepe"));

				expect(Result.getOrThrow(result)).toEqual(worktrees);
			})
		));

	it("loadWorktreeConfig returns null when the server has no config", () =>
		Effect.runPromise(
			Effect.gen(function* () {
				setAppRpcClientForTest(
					makeClient(() => Effect.succeed({ op: "git.loadWorktreeConfig", config: null }))
				);

				const result = yield* Effect.result(git.loadWorktreeConfig("/tmp/acepe"));

				expect(result.pipe(Result.getOrThrow)).toBeNull();
			})
		));

	it("loadWorktreeConfig returns the setupCommands when the server has a config", () =>
		Effect.runPromise(
			Effect.gen(function* () {
				setAppRpcClientForTest(
					makeClient(() =>
						Effect.succeed({
							op: "git.loadWorktreeConfig",
							config: { setupCommands: ["bun install"] },
						})
					)
				);

				const result = yield* Effect.result(git.loadWorktreeConfig("/tmp/acepe"));

				expect(Result.getOrThrow(result)).toEqual({ setupCommands: ["bun install"] });
			})
		));

	it("saveWorktreeConfig sends the projectPath and setupCommands", () =>
		Effect.runPromise(
			Effect.gen(function* () {
				let requested: unknown = null;
				setAppRpcClientForTest(
					makeClient((request) => {
						requested = request;
						return Effect.succeed({ op: "git.saveWorktreeConfig" });
					})
				);

				const result = yield* Effect.result(git.saveWorktreeConfig("/tmp/acepe", ["bun install"]));

				expect(Result.isSuccess(result)).toBe(true);
				expect(requested).toEqual({
					op: "git.saveWorktreeConfig",
					projectPath: "/tmp/acepe",
					setupCommands: ["bun install"],
				});
			})
		));

	it("runWorktreeSetup maps GitService's SetupResult shape onto the facade's own shape", () =>
		Effect.runPromise(
			Effect.gen(function* () {
				let requested: unknown = null;
				setAppRpcClientForTest(
					makeClient((request) => {
						requested = request;
						return Effect.succeed({
							op: "git.runWorktreeSetup",
							result: {
								success: false,
								outputs: [
									{ command: "bun install", stdout: "installed\n", stderr: "", exitCode: 0 },
									{ command: "bun test", stdout: "", stderr: "boom", exitCode: 1 },
								],
								error: "Command failed: bun test",
							},
						});
					})
				);

				const result = yield* Effect.result(
					git.runWorktreeSetup("/tmp/acepe-wt/clever-falcon", "/tmp/acepe")
				);

				expect(Result.getOrThrow(result)).toEqual({
					success: false,
					commandsRun: 2,
					error: "Command failed: bun test",
					output: [
						{
							command: "bun install",
							success: true,
							stdout: "installed\n",
							stderr: "",
							exitCode: 0,
						},
						{ command: "bun test", success: false, stdout: "", stderr: "boom", exitCode: 1 },
					],
				});
				expect(requested).toEqual({
					op: "git.runWorktreeSetup",
					worktreePath: "/tmp/acepe-wt/clever-falcon",
					projectPath: "/tmp/acepe",
				});
			})
		));

	it("runStackedAction sends the optional prTitle/prBody and returns the nested result", () =>
		Effect.runPromise(
			Effect.gen(function* () {
				let requested: unknown = null;
				const stackedResult = {
					action: "commit_push_pr" as const,
					commit: { status: "created" as const, commitSha: "abc123", subject: "fix: thing" },
					push: { status: "pushed" as const, branch: "feature/x", upstreamBranch: "feature/x" },
					pr: {
						status: "created" as const,
						url: "https://github.com/flazouh/acepe/pull/1",
						number: 1,
						title: "Fix thing",
						baseBranch: "main",
						headBranch: "feature/x",
					},
				};
				setAppRpcClientForTest(
					makeClient((request) => {
						requested = request;
						return Effect.succeed({ op: "git.runStackedAction", result: stackedResult });
					})
				);

				const result = yield* Effect.result(
					git.runStackedAction("/tmp/acepe", "commit_push_pr", "fix: thing", "Fix thing")
				);

				expect(Result.getOrThrow(result)).toEqual(stackedResult);
				expect(requested).toEqual({
					op: "git.runStackedAction",
					projectPath: "/tmp/acepe",
					action: "commit_push_pr",
					commitMessage: "fix: thing",
					prTitle: "Fix thing",
				});
			})
		));

	it("collectShipContext returns null when the server has no staged diff", () =>
		Effect.runPromise(
			Effect.gen(function* () {
				setAppRpcClientForTest(
					makeClient(() => Effect.succeed({ op: "git.collectShipContext", context: null }))
				);

				const result = yield* Effect.result(git.collectShipContext("/tmp/acepe"));

				expect(result.pipe(Result.getOrThrow)).toBeNull();
			})
		));

	it("prDetails returns the details with a mutable commits array", () =>
		Effect.runPromise(
			Effect.gen(function* () {
				const details = {
					number: 235,
					title: "fix(website): remove landing announcement banner",
					body: "",
					state: "MERGED" as const,
					url: "https://github.com/flazouh/acepe/pull/235",
					isDraft: false,
					additions: 1,
					deletions: 1,
					commits: [{ oid: "abc", messageHeadline: "fix it", additions: 1, deletions: 1 }],
				};
				setAppRpcClientForTest(makeClient(() => Effect.succeed({ op: "git.prDetails", details })));

				const result = yield* Effect.result(git.prDetails("/tmp/acepe", 235));

				expect(Result.getOrThrow(result)).toEqual(details);
			})
		));

	it("prChecks returns the checks with a mutable checkRuns array", () =>
		Effect.runPromise(
			Effect.gen(function* () {
				const checks = {
					prNumber: 235,
					headSha: "abc123",
					checkRuns: [
						{
							name: "build",
							status: "COMPLETED" as const,
							conclusion: "SUCCESS" as const,
							detailsUrl: null,
							startedAt: null,
							completedAt: null,
							workflowName: null,
						},
					],
				};
				setAppRpcClientForTest(makeClient(() => Effect.succeed({ op: "git.prChecks", checks })));

				const result = yield* Effect.result(git.prChecks("/tmp/acepe", 235));

				expect(Result.getOrThrow(result)).toEqual(checks);
			})
		));

	it("mergePr sends the projectPath, prNumber, and strategy", () =>
		Effect.runPromise(
			Effect.gen(function* () {
				let requested: unknown = null;
				setAppRpcClientForTest(
					makeClient((request) => {
						requested = request;
						return Effect.succeed({ op: "git.mergePr" });
					})
				);

				const result = yield* Effect.result(git.mergePr("/tmp/acepe", 235, "squash"));

				expect(Result.isSuccess(result)).toBe(true);
				expect(requested).toEqual({
					op: "git.mergePr",
					projectPath: "/tmp/acepe",
					prNumber: 235,
					strategy: "squash",
				});
			})
		));

	it("ciJobDetails returns the details with a mutable steps array", () =>
		Effect.runPromise(
			Effect.gen(function* () {
				const details = {
					id: 1,
					name: "build",
					status: "completed",
					conclusion: "success",
					steps: [
						{ number: 1, name: "checkout", status: "completed", conclusion: "success", log: "" },
					],
				};
				setAppRpcClientForTest(
					makeClient(() => Effect.succeed({ op: "git.ciJobDetails", details }))
				);

				const result = yield* Effect.result(
					git.ciJobDetails("/tmp/acepe", "https://github.com/flazouh/acepe/actions/runs/1")
				);

				expect(Result.getOrThrow(result)).toEqual(details);
			})
		));

	it("dies when the server routes to the wrong op", () =>
		Effect.runPromise(
			Effect.gen(function* () {
				setAppRpcClientForTest(
					// The server would never legitimately answer a git.isRepo request with
					// a git.currentBranch result -- unwrapGitCallResult treats a mismatch
					// as a defect (Effect.die), a wiring bug rather than a typed AppError
					// the caller could recover from. Effect.exit (not Effect.result, which
					// only captures typed failures) is what surfaces a defect in a test.
					makeClient(() => Effect.succeed({ op: "git.currentBranch", branch: "main" }))
				);

				const exit = yield* Effect.exit(git.isRepo("/tmp/acepe"));

				expect(Exit.isFailure(exit)).toBe(true);
				if (Exit.isFailure(exit)) {
					expect(Cause.hasDies(exit.cause)).toBe(true);
				}
			})
		));
});
