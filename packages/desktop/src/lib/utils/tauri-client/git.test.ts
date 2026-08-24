import { afterEach, describe, expect, it } from "bun:test";
import {
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
	events: () => Stream.empty,
});

afterEach(() => {
	setAppRpcClientForTest(null);
});

describe("git tauri client", () => {
	it("init sends the projectPath and resolves to void", async () => {
		let requested: unknown = null;
		setAppRpcClientForTest(
			makeClient((request) => {
				requested = request;
				return Effect.succeed({ op: "git.init" });
			})
		);

		const result = await Effect.runPromise(Effect.result(git.init("/tmp/acepe")));

		expect(Result.isSuccess(result)).toBe(true);
		expect(requested).toEqual({ op: "git.init", projectPath: "/tmp/acepe" });
	});

	it("isRepo unwraps the tagged-union result", async () => {
		setAppRpcClientForTest(makeClient(() => Effect.succeed({ op: "git.isRepo", isRepo: true })));

		const result = await Effect.runPromise(Effect.result(git.isRepo("/tmp/acepe")));

		expect(Result.isSuccess(result)).toBe(true);
		expect(Result.getOrThrow(result)).toBe(true);
	});

	it("currentBranch returns the branch name", async () => {
		setAppRpcClientForTest(
			makeClient(() => Effect.succeed({ op: "git.currentBranch", branch: "main" }))
		);

		const result = await Effect.runPromise(Effect.result(git.currentBranch("/tmp/acepe")));

		expect(Result.getOrThrow(result)).toBe("main");
	});

	it("listBranches returns the branch array", async () => {
		setAppRpcClientForTest(
			makeClient(() => Effect.succeed({ op: "git.listBranches", branches: ["main", "feature/x"] }))
		);

		const result = await Effect.runPromise(Effect.result(git.listBranches("/tmp/acepe")));

		expect(Result.getOrThrow(result)).toEqual(["main", "feature/x"]);
	});

	it("checkoutBranch sends the create flag and returns the branch", async () => {
		let requested: unknown = null;
		setAppRpcClientForTest(
			makeClient((request) => {
				requested = request;
				return Effect.succeed({ op: "git.checkoutBranch", branch: "feature/x" });
			})
		);

		const result = await Effect.runPromise(
			Effect.result(git.checkoutBranch("/tmp/acepe", "feature/x", true))
		);

		expect(Result.getOrThrow(result)).toBe("feature/x");
		expect(requested).toEqual({
			op: "git.checkoutBranch",
			projectPath: "/tmp/acepe",
			branch: "feature/x",
			create: true,
		});
	});

	it("hasUncommittedChanges returns the boolean", async () => {
		setAppRpcClientForTest(
			makeClient(() =>
				Effect.succeed({ op: "git.hasUncommittedChanges", hasUncommittedChanges: true })
			)
		);

		const result = await Effect.runPromise(Effect.result(git.hasUncommittedChanges("/tmp/acepe")));

		expect(Result.getOrThrow(result)).toBe(true);
	});

	it("panelStatus returns the file status array", async () => {
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

		const result = await Effect.runPromise(Effect.result(git.panelStatus("/tmp/acepe")));

		expect(Result.getOrThrow(result)).toEqual(files);
	});

	it("stageFiles sends the file list and resolves to void", async () => {
		let requested: unknown = null;
		setAppRpcClientForTest(
			makeClient((request) => {
				requested = request;
				return Effect.succeed({ op: "git.stageFiles" });
			})
		);

		const result = await Effect.runPromise(
			Effect.result(git.stageFiles("/tmp/acepe", ["a.ts", "b.ts"]))
		);

		expect(Result.isSuccess(result)).toBe(true);
		expect(requested).toEqual({
			op: "git.stageFiles",
			projectPath: "/tmp/acepe",
			files: ["a.ts", "b.ts"],
		});
	});

	it("unstageFiles sends the file list and resolves to void", async () => {
		let requested: unknown = null;
		setAppRpcClientForTest(
			makeClient((request) => {
				requested = request;
				return Effect.succeed({ op: "git.unstageFiles" });
			})
		);

		const result = await Effect.runPromise(Effect.result(git.unstageFiles("/tmp/acepe", ["a.ts"])));

		expect(Result.isSuccess(result)).toBe(true);
		expect(requested).toEqual({
			op: "git.unstageFiles",
			projectPath: "/tmp/acepe",
			files: ["a.ts"],
		});
	});

	it("stageAll resolves to void", async () => {
		let requested: unknown = null;
		setAppRpcClientForTest(
			makeClient((request) => {
				requested = request;
				return Effect.succeed({ op: "git.stageAll" });
			})
		);

		const result = await Effect.runPromise(Effect.result(git.stageAll("/tmp/acepe")));

		expect(Result.isSuccess(result)).toBe(true);
		expect(requested).toEqual({ op: "git.stageAll", projectPath: "/tmp/acepe" });
	});

	it("discardChanges sends the file list and resolves to void", async () => {
		let requested: unknown = null;
		setAppRpcClientForTest(
			makeClient((request) => {
				requested = request;
				return Effect.succeed({ op: "git.discardChanges" });
			})
		);

		const result = await Effect.runPromise(
			Effect.result(git.discardChanges("/tmp/acepe", ["a.ts"]))
		);

		expect(Result.isSuccess(result)).toBe(true);
		expect(requested).toEqual({
			op: "git.discardChanges",
			projectPath: "/tmp/acepe",
			files: ["a.ts"],
		});
	});

	it("commit returns the sha and shortSha", async () => {
		let requested: unknown = null;
		setAppRpcClientForTest(
			makeClient((request) => {
				requested = request;
				return Effect.succeed({ op: "git.commit", sha: "abc123", shortSha: "abc123".slice(0, 7) });
			})
		);

		const result = await Effect.runPromise(Effect.result(git.commit("/tmp/acepe", "message")));

		expect(Result.getOrThrow(result)).toEqual({ sha: "abc123", shortSha: "abc123" });
		expect(requested).toEqual({
			op: "git.commit",
			projectPath: "/tmp/acepe",
			message: "message",
		});
	});

	it("log sends the limit and returns the entries", async () => {
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

		const result = await Effect.runPromise(Effect.result(git.log("/tmp/acepe", 10)));

		expect(Result.getOrThrow(result)).toEqual(entries);
		expect(requested).toEqual({ op: "git.log", projectPath: "/tmp/acepe", limit: 10 });
	});

	it("push sends the projectPath and resolves to void", async () => {
		let requested: unknown = null;
		setAppRpcClientForTest(
			makeClient((request) => {
				requested = request;
				return Effect.succeed({ op: "git.push" });
			})
		);

		const result = await Effect.runPromise(Effect.result(git.push("/tmp/acepe")));

		expect(Result.isSuccess(result)).toBe(true);
		expect(requested).toEqual({ op: "git.push", projectPath: "/tmp/acepe" });
	});

	it("pull sends the projectPath and resolves to void", async () => {
		let requested: unknown = null;
		setAppRpcClientForTest(
			makeClient((request) => {
				requested = request;
				return Effect.succeed({ op: "git.pull" });
			})
		);

		const result = await Effect.runPromise(Effect.result(git.pull("/tmp/acepe")));

		expect(Result.isSuccess(result)).toBe(true);
		expect(requested).toEqual({ op: "git.pull", projectPath: "/tmp/acepe" });
	});

	it("fetch sends the projectPath and resolves to void", async () => {
		let requested: unknown = null;
		setAppRpcClientForTest(
			makeClient((request) => {
				requested = request;
				return Effect.succeed({ op: "git.fetch" });
			})
		);

		const result = await Effect.runPromise(Effect.result(git.fetch("/tmp/acepe")));

		expect(Result.isSuccess(result)).toBe(true);
		expect(requested).toEqual({ op: "git.fetch", projectPath: "/tmp/acepe" });
	});

	it("remoteStatus returns the ahead/behind/remote/trackingBranch fields", async () => {
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

		const result = await Effect.runPromise(Effect.result(git.remoteStatus("/tmp/acepe")));

		expect(Result.getOrThrow(result)).toEqual({
			ahead: 2,
			behind: 1,
			remote: "origin",
			trackingBranch: "origin/main",
		});
	});

	it("stashList returns the stash entries", async () => {
		const entries = [{ index: 0, message: "WIP on main", date: "2 hours ago" }];
		setAppRpcClientForTest(makeClient(() => Effect.succeed({ op: "git.stashList", entries })));

		const result = await Effect.runPromise(Effect.result(git.stashList("/tmp/acepe")));

		expect(Result.getOrThrow(result)).toEqual(entries);
	});

	it("stashPop sends the projectPath and index", async () => {
		let requested: unknown = null;
		setAppRpcClientForTest(
			makeClient((request) => {
				requested = request;
				return Effect.succeed({ op: "git.stashPop" });
			})
		);

		const result = await Effect.runPromise(Effect.result(git.stashPop("/tmp/acepe", 2)));

		expect(Result.isSuccess(result)).toBe(true);
		expect(requested).toEqual({ op: "git.stashPop", projectPath: "/tmp/acepe", index: 2 });
	});

	it("stashDrop sends the projectPath and index", async () => {
		let requested: unknown = null;
		setAppRpcClientForTest(
			makeClient((request) => {
				requested = request;
				return Effect.succeed({ op: "git.stashDrop" });
			})
		);

		const result = await Effect.runPromise(Effect.result(git.stashDrop("/tmp/acepe", 1)));

		expect(Result.isSuccess(result)).toBe(true);
		expect(requested).toEqual({ op: "git.stashDrop", projectPath: "/tmp/acepe", index: 1 });
	});

	it("dies when the server routes to the wrong op", async () => {
		setAppRpcClientForTest(
			// The server would never legitimately answer a git.isRepo request with
			// a git.currentBranch result -- unwrapGitCallResult treats a mismatch
			// as a defect (Effect.die), a wiring bug rather than a typed AppError
			// the caller could recover from. Effect.exit (not Effect.result, which
			// only captures typed failures) is what surfaces a defect in a test.
			makeClient(() => Effect.succeed({ op: "git.currentBranch", branch: "main" }))
		);

		const exit = await Effect.runPromise(Effect.exit(git.isRepo("/tmp/acepe")));

		expect(Exit.isFailure(exit)).toBe(true);
		if (Exit.isFailure(exit)) {
			expect(Cause.hasDies(exit.cause)).toBe(true);
		}
	});
});
