import { describe, expect, it } from "bun:test";
import { okAsync, ResultAsync } from "neverthrow";
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

describe("git status cache", () => {
	it("reuses cached values within ttl", async () => {
		let now = 1000;
		let fetchCount = 0;

		const cache = createGitStatusCache({
			ttlMs: 2000,
			now: () => now,
			fetchGitStatus: () => {
				fetchCount += 1;
				return okAsync([createStatus("src/file.ts", 2, 1)]);
			},
		});

		const first = await cache.getProjectGitStatusMap("/repo");
		expect(first.isOk()).toBe(true);
		expect(fetchCount).toBe(1);

		now += 1000;
		const second = await cache.getProjectGitStatusMap("/repo");
		expect(second.isOk()).toBe(true);
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
				return okAsync([createStatus("src/file.ts", fetchCount, 0)]);
			},
		});

		const first = await cache.getProjectGitStatusMap("/repo");
		expect(first.isOk()).toBe(true);
		expect(fetchCount).toBe(1);

		now += 2500;
		const second = await cache.getProjectGitStatusMap("/repo");
		expect(second.isOk()).toBe(true);
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
				return ResultAsync.fromPromise(
					deferred.promise,
					(error): AppError =>
						new AgentError(
							"test-getProjectGitStatus",
							error instanceof Error ? error : new Error(String(error))
						)
				);
			},
		});

		const firstPromise = cache.getProjectGitStatusMap("/repo");
		const secondPromise = cache.getProjectGitStatusMap("/repo");

		expect(fetchCount).toBe(1);

		deferred.resolve([createStatus("src/file.ts", 4, 2)]);

		const [first, second] = await Promise.all([firstPromise, secondPromise]);
		expect(first.isOk()).toBe(true);
		expect(second.isOk()).toBe(true);
	});

	it("uses the summary fetcher for summary status maps", async () => {
		let fullFetchCount = 0;
		let summaryFetchCount = 0;

		const cache = createGitStatusCache({
			ttlMs: 2000,
			now: () => 1000,
			fetchGitStatus: () => {
				fullFetchCount += 1;
				return okAsync([createStatus("src/full.ts", 8, 3)]);
			},
			fetchGitStatusSummary: () => {
				summaryFetchCount += 1;
				return okAsync([createStatus("src/summary.ts", 0, 0)]);
			},
		});

		const summary = await cache.getProjectGitStatusSummaryMap("/repo");

		expect(summary.isOk()).toBe(true);
		expect(fullFetchCount).toBe(0);
		expect(summaryFetchCount).toBe(1);
		expect(summary._unsafeUnwrap().get("src/summary.ts")?.insertions).toBe(0);
	});

	it("fetches one file summary status without fetching the project summary map", async () => {
		let summaryFetchCount = 0;
		let fileSummaryFetchCount = 0;

		const cache = createGitStatusCache({
			ttlMs: 2000,
			now: () => 1000,
			fetchGitStatusSummary: () => {
				summaryFetchCount += 1;
				return okAsync([createStatus("src/project.ts", 1, 0)]);
			},
			fetchFileGitStatusSummary: (_projectPath, filePath) => {
				fileSummaryFetchCount += 1;
				return okAsync(filePath.endsWith("two.ts") ? createStatus("src/two.ts", 4, 2) : null);
			},
		});

		const first = await cache.getProjectFileGitStatusSummary("/repo", "/repo/src/two.ts");
		const second = await cache.getProjectFileGitStatusSummary("/repo", "/repo/src/two.ts");

		expect(first.isOk()).toBe(true);
		expect(second.isOk()).toBe(true);
		expect(first._unsafeUnwrap()?.path).toBe("src/two.ts");
		expect(second._unsafeUnwrap()?.path).toBe("src/two.ts");
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
				return okAsync([createStatus("src/one.ts", 1, 0), createStatus("src/two.ts", 4, 2)]);
			},
			fetchFileGitStatusSummary: () => {
				fileSummaryFetchCount += 1;
				return okAsync(null);
			},
		});

		await cache.getProjectGitStatusSummaryMap("/repo");
		const result = await cache.getProjectFileGitStatusSummary("/repo", "/repo/src/two.ts");

		expect(result.isOk()).toBe(true);
		expect(result._unsafeUnwrap()?.path).toBe("src/two.ts");
		expect(summaryFetchCount).toBe(1);
		expect(fileSummaryFetchCount).toBe(0);
	});

	it("does not scan a cached project summary map for one file lookup misses", async () => {
		let fileSummaryFetchCount = 0;
		const statuses = [createStatus("src/one.ts", 1, 0), createStatus("src/two.ts", 4, 2)];

		const cache = createGitStatusCache({
			ttlMs: 2000,
			now: () => 1000,
			fetchGitStatusSummary: () => okAsync(statuses),
			fetchFileGitStatusSummary: (_projectPath, filePath) => {
				fileSummaryFetchCount += 1;
				return okAsync(
					filePath.endsWith("nested/two.ts") ? createStatus("nested/two.ts", 7, 3) : null
				);
			},
		});

		await cache.getProjectGitStatusSummaryMap("/repo");
		const result = await cache.getProjectFileGitStatusSummary(
			"/repo/nested",
			"/repo/nested/two.ts"
		);

		expect(result.isOk()).toBe(true);
		expect(result._unsafeUnwrap()?.path).toBe("nested/two.ts");
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
				return okAsync([createStatus("src/full.ts", fullFetchCount, 0)]);
			},
			fetchGitStatusSummary: () => {
				summaryFetchCount += 1;
				return okAsync([createStatus("src/summary.ts", summaryFetchCount, 0)]);
			},
		});

		await cache.getProjectGitStatusMap("/repo");
		await cache.getProjectGitStatusSummaryMap("/repo");
		cache.invalidateProjectGitStatus("/repo");
		await cache.getProjectGitStatusMap("/repo");
		await cache.getProjectGitStatusSummaryMap("/repo");

		expect(fullFetchCount).toBe(2);
		expect(summaryFetchCount).toBe(2);
	});
});
