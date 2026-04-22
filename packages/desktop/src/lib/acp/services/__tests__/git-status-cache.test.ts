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
});
