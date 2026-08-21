import { fromPromise } from "@acepe/effect-result/fromPromise";
import { describe, expect, it } from "bun:test";
import * as Effect from "effect/Effect";
import * as Result from "effect/Result";
import type { FileGitStatus } from "$lib/services/converted-session-types.js";
import type { AppError } from "../../errors/app-error.js";
import { AgentError } from "../../errors/app-error.js";

import { createGitStatusCache } from "../git-status-cache.svelte.js";

function createDeferred<T>(): {
	promise: Promise<T>;
	resolve: (value: T) => void;
	reject: (reason?: Error) => void;
} {
	let resolveFn: (value: T) => void = () => {};
	let rejectFn: (reason?: Error) => void = () => {};

	const promise = new Promise<T>((resolve, reject) => {
		resolveFn = resolve;
		rejectFn = reject;
	});

	return {
		promise,
		resolve: resolveFn,
		reject: rejectFn,
	};
}

function createStatus(path: string, insertions: number, deletions: number): FileGitStatus {
	return {
		path,
		status: "M",
		insertions,
		deletions,
	};
}

function toAppError(error: unknown): AppError {
	return new AgentError(
		"test-getProjectGitStatus",
		error instanceof Error ? error : new Error(String(error))
	);
}

async function runResult<A, E>(effect: Effect.Effect<A, E>) {
	return Effect.runPromise(Effect.result(effect));
}

describe("git status cache", () => {
	it("reuses cached values within ttl", async () => {
		let now = 1000;
		let fetchCount = 0;

		const cache = createGitStatusCache({
			ttlMs: 2000,
			now: () => now,
			fetchGitStatus: () => {
				fetchCount += 1;
				return Effect.succeed([createStatus("src/file.ts", 2, 1)]);
			},
		});

		const first = await runResult(cache.getProjectGitStatusMap("/repo"));
		expect(Result.isSuccess(first)).toBe(true);
		expect(fetchCount).toBe(1);

		now += 1000;
		const second = await runResult(cache.getProjectGitStatusMap("/repo"));
		expect(Result.isSuccess(second)).toBe(true);
		expect(fetchCount).toBe(1);
	});

	it("refreshes after ttl expires", async () => {
		let now = 1000;
		let fetchCount = 0;

		const cache = createGitStatusCache({
			ttlMs: 2000,
			now: () => now,
			fetchGitStatus: () => {
				fetchCount += 1;
				return Effect.succeed([createStatus("src/file.ts", fetchCount, 0)]);
			},
		});

		const first = await runResult(cache.getProjectGitStatusMap("/repo"));
		expect(Result.isSuccess(first)).toBe(true);
		expect(fetchCount).toBe(1);

		now += 2500;
		const second = await runResult(cache.getProjectGitStatusMap("/repo"));
		expect(Result.isSuccess(second)).toBe(true);
		expect(fetchCount).toBe(2);
	});

	it("dedupes in-flight requests for the same project", async () => {
		const deferred = createDeferred<ReadonlyArray<FileGitStatus>>();
		let fetchCount = 0;

		const cache = createGitStatusCache({
			ttlMs: 2000,
			now: () => 1000,
			fetchGitStatus: () => {
				fetchCount += 1;
				return fromPromise(() => deferred.promise, toAppError);
			},
		});

		const firstPromise = cache.getProjectGitStatusMap("/repo");
		const secondPromise = cache.getProjectGitStatusMap("/repo");

		expect(fetchCount).toBe(1);

		deferred.resolve([createStatus("src/file.ts", 4, 2)]);

		const [first, second] = await Promise.all([runResult(firstPromise), runResult(secondPromise)]);
		expect(Result.isSuccess(first)).toBe(true);
		expect(Result.isSuccess(second)).toBe(true);
	});

	it("uses the summary fetcher for summary status maps", async () => {
		let fullFetchCount = 0;
		let summaryFetchCount = 0;

		const cache = createGitStatusCache({
			ttlMs: 2000,
			now: () => 1000,
			fetchGitStatus: () => {
				fullFetchCount += 1;
				return Effect.succeed([createStatus("src/full.ts", 8, 3)]);
			},
			fetchGitStatusSummary: () => {
				summaryFetchCount += 1;
				return Effect.succeed([createStatus("src/summary.ts", 0, 0)]);
			},
		});

		const summary = await runResult(cache.getProjectGitStatusSummaryMap("/repo"));

		expect(Result.isSuccess(summary)).toBe(true);
		expect(fullFetchCount).toBe(0);
		expect(summaryFetchCount).toBe(1);
		expect(Result.getOrThrow(summary).get("src/summary.ts")?.insertions).toBe(0);
	});

	it("fetches one file summary status without fetching the project summary map", async () => {
		let summaryFetchCount = 0;
		let fileSummaryFetchCount = 0;

		const cache = createGitStatusCache({
			ttlMs: 2000,
			now: () => 1000,
			fetchGitStatusSummary: () => {
				summaryFetchCount += 1;
				return Effect.succeed([createStatus("src/project.ts", 1, 0)]);
			},
			fetchFileGitStatusSummary: (_projectPath, filePath) => {
				fileSummaryFetchCount += 1;
				return Effect.succeed(filePath.endsWith("two.ts") ? createStatus("src/two.ts", 4, 2) : null);
			},
		});

		const first = await runResult(cache.getProjectFileGitStatusSummary("/repo", "/repo/src/two.ts"));
		const second = await runResult(
			cache.getProjectFileGitStatusSummary("/repo", "/repo/src/two.ts")
		);

		expect(Result.isSuccess(first)).toBe(true);
		expect(Result.isSuccess(second)).toBe(true);
		expect(Result.getOrThrow(first)?.path).toBe("src/two.ts");
		expect(Result.getOrThrow(second)?.path).toBe("src/two.ts");
		expect(summaryFetchCount).toBe(0);
		expect(fileSummaryFetchCount).toBe(1);
	});

	it("selects one file from an already cached project summary map", async () => {
		let summaryFetchCount = 0;
		let fileSummaryFetchCount = 0;

		const cache = createGitStatusCache({
			ttlMs: 2000,
			now: () => 1000,
			fetchGitStatusSummary: () => {
				summaryFetchCount += 1;
				return Effect.succeed([createStatus("src/one.ts", 1, 0), createStatus("src/two.ts", 4, 2)]);
			},
			fetchFileGitStatusSummary: () => {
				fileSummaryFetchCount += 1;
				return Effect.succeed(null);
			},
		});

		await runResult(cache.getProjectGitStatusSummaryMap("/repo"));
		const result = await runResult(
			cache.getProjectFileGitStatusSummary("/repo", "/repo/src/two.ts")
		);

		expect(Result.isSuccess(result)).toBe(true);
		expect(Result.getOrThrow(result)?.path).toBe("src/two.ts");
		expect(summaryFetchCount).toBe(1);
		expect(fileSummaryFetchCount).toBe(0);
	});

	it("does not scan a cached project summary map for one file lookup misses", async () => {
		let fileSummaryFetchCount = 0;
		const statuses = [createStatus("src/one.ts", 1, 0), createStatus("src/two.ts", 4, 2)];

		const cache = createGitStatusCache({
			ttlMs: 2000,
			now: () => 1000,
			fetchGitStatusSummary: () => Effect.succeed(statuses),
			fetchFileGitStatusSummary: (_projectPath, filePath) => {
				fileSummaryFetchCount += 1;
				return Effect.succeed(
					filePath.endsWith("nested/two.ts") ? createStatus("nested/two.ts", 7, 3) : null
				);
			},
		});

		await runResult(cache.getProjectGitStatusSummaryMap("/repo"));
		const result = await runResult(
			cache.getProjectFileGitStatusSummary("/repo/nested", "/repo/nested/two.ts")
		);

		expect(Result.isSuccess(result)).toBe(true);
		expect(Result.getOrThrow(result)?.path).toBe("nested/two.ts");
		expect(fileSummaryFetchCount).toBe(1);
	});

	it("invalidates full and summary status maps together", async () => {
		let fullFetchCount = 0;
		let summaryFetchCount = 0;

		const cache = createGitStatusCache({
			ttlMs: 2000,
			now: () => 1000,
			fetchGitStatus: () => {
				fullFetchCount += 1;
				return Effect.succeed([createStatus("src/full.ts", fullFetchCount, 0)]);
			},
			fetchGitStatusSummary: () => {
				summaryFetchCount += 1;
				return Effect.succeed([createStatus("src/summary.ts", summaryFetchCount, 0)]);
			},
		});

		await runResult(cache.getProjectGitStatusMap("/repo"));
		await runResult(cache.getProjectGitStatusSummaryMap("/repo"));
		cache.invalidateProjectGitStatus("/repo");
		await runResult(cache.getProjectGitStatusMap("/repo"));
		await runResult(cache.getProjectGitStatusSummaryMap("/repo"));

		expect(fullFetchCount).toBe(2);
		expect(summaryFetchCount).toBe(2);
	});
});
