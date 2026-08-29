import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import * as Effect from "effect/Effect";
import * as Result from "effect/Result";
import { setAppRpcClientForTest } from "../../../rpc/app-client.ts";
import { makeGitCallRpcClient } from "../../../rpc/fake-rpc-client.ts";
import type { RepoContext } from "../../types/github-integration.js";
import {
	clearDiffCache,
	clearRepoContextCache,
	clearRepoContextInflight,
	getRepoContext,
} from "../github-service.ts";

const repoContext: RepoContext = {
	owner: "flazouh",
	repo: "acepe",
	remoteUrl: "git@github.com:flazouh/acepe.git",
};

let calls = 0;

beforeEach(() => {
	calls = 0;
	setAppRpcClientForTest(
		makeGitCallRpcClient(() => {
			calls += 1;
			return Effect.succeed({ op: "git.repoContext", context: repoContext });
		})
	);
	clearDiffCache();
	clearRepoContextCache();
	clearRepoContextInflight();
});

afterEach(() => {
	setAppRpcClientForTest(null);
});

describe("GitHub Service - repo context cache", () => {
	it("exports repo context cache reset hooks for deterministic tests", () => {
		expect(typeof clearRepoContextCache).toBe("function");
		expect(typeof clearRepoContextInflight).toBe("function");
	});

	it("refetches repo context after clearing the repo context cache", async () => {
		const first = await Effect.runPromise(Effect.result(getRepoContext("/repo")));
		const second = await Effect.runPromise(Effect.result(getRepoContext("/repo")));

		expect(Result.isSuccess(first)).toBe(true);
		expect(Result.isSuccess(second)).toBe(true);
		expect(calls).toBe(1);

		clearRepoContextCache();

		const third = await Effect.runPromise(Effect.result(getRepoContext("/repo")));
		expect(Result.isSuccess(third)).toBe(true);
		expect(calls).toBe(2);
	});
});
