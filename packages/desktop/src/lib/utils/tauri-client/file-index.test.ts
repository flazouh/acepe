import { afterEach, describe, expect, it } from "bun:test";
import type { RpcClient } from "@acepe/contracts";
import { emptyRpcSessionSnapshot } from "@acepe/contracts";
import * as Effect from "effect/Effect";
import * as Result from "effect/Result";
import * as Stream from "effect/Stream";

import { setAppRpcClientForTest } from "../../rpc/app-client.ts";
import { fileIndex } from "./file-index.ts";

const projectIndex = {
	projectPath: "/repo/acepe",
	files: [
		{
			path: "src/main.ts",
			extension: "ts",
			lineCount: 10,
			gitStatus: {
				path: "src/main.ts",
				status: "M",
				insertions: 2,
				deletions: 1,
			},
		},
	],
	gitStatus: [
		{
			path: "src/main.ts",
			status: "M",
			insertions: 2,
			deletions: 1,
		},
	],
	totalFiles: 1,
	totalLines: 10,
};

const makeClient = (overrides: Partial<RpcClient>): RpcClient => ({
	dispatch: () => Effect.succeed({ sequence: 1 }),
	snapshot: () => Effect.succeed(emptyRpcSessionSnapshot(0)),
	getProjectIndex: () => Effect.succeed(projectIndex),
	invalidateProjectIndex: () => Effect.void,
	events: () => Stream.empty,
	...overrides,
});

afterEach(() => {
	setAppRpcClientForTest(null);
});

describe("fileIndex rpc facade", () => {
	it("reads project files through getProjectIndex", () =>
		Effect.runPromise(
			Effect.gen(function* () {
				let requestedPath = "";
				setAppRpcClientForTest(
					makeClient({
						getProjectIndex: (projectPath) => {
							requestedPath = projectPath;
							return Effect.succeed(projectIndex);
						},
					})
				);
				const index = yield* fileIndex.getProjectFiles("/repo/acepe");
				expect(requestedPath).toBe("/repo/acepe");
				expect(index.totalFiles).toBe(1);
				expect(index.gitStatus[0]?.status).toBe("M");
			})
		));

	it("returns a git overview without a branch field on the contract", () =>
		Effect.runPromise(
			Effect.gen(function* () {
				setAppRpcClientForTest(makeClient({}));
				const overview = yield* fileIndex.getProjectGitOverviewSummary("/repo/acepe");
				expect(overview.branch).toBeNull();
				expect(overview.gitStatus).toEqual(projectIndex.gitStatus);
			})
		));

	it("invalidates the project index", () =>
		Effect.runPromise(
			Effect.gen(function* () {
				let invalidated = "";
				setAppRpcClientForTest(
					makeClient({
						invalidateProjectIndex: (projectPath) => {
							invalidated = projectPath;
							return Effect.void;
						},
					})
				);
				yield* fileIndex.invalidateProjectFiles("/repo/acepe");
				expect(invalidated).toBe("/repo/acepe");
			})
		));

	it("fails file reads that are not on the contract", () =>
		Effect.runPromise(
			Effect.gen(function* () {
				setAppRpcClientForTest(makeClient({}));
				const result = yield* Effect.result(
					fileIndex.readFileContent("src/main.ts", "/repo/acepe")
				);
				expect(Result.isFailure(result)).toBe(true);
			})
		));
});
