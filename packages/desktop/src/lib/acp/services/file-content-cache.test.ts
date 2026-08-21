import { fromPromise } from "@acepe/effect-result/fromPromise";
import { describe, expect, it } from "bun:test";
import * as Effect from "effect/Effect";
import * as Result from "effect/Result";

import { createFileContentCache } from "./file-content-cache.svelte.js";

function createDeferred<T>() {
	let resolve!: (value: T) => void;
	const promise = new Promise<T>((nextResolve) => {
		resolve = nextResolve;
	});
	return { promise, resolve };
}

function toUnknownError(error: unknown): unknown {
	return error;
}

async function runResult<A, E>(effect: Effect.Effect<A, E>) {
	return Effect.runPromise(Effect.result(effect));
}

describe("fileContentCache", () => {
	it("shares in-flight file content reads for the same file", async () => {
		const deferred = createDeferred<string>();
		let fetchCount = 0;
		const cache = createFileContentCache({ fetchFileContent });
		function fetchFileContent() {
			fetchCount += 1;
			return fromPromise(() => deferred.promise, toUnknownError);
		}

		const first = cache.getFileContent("src/app.ts", "/repo");
		const second = cache.getFileContent("src/app.ts", "/repo");

		expect(fetchCount).toBe(1);
		deferred.resolve("export const answer = 42;\n");

		const firstResult = await runResult(first);
		const secondResult = await runResult(second);
		expect(Result.isSuccess(firstResult)).toBe(true);
		expect(Result.isSuccess(secondResult)).toBe(true);
		if (Result.isSuccess(firstResult) && Result.isSuccess(secondResult)) {
			expect(firstResult.success).toBe("export const answer = 42;\n");
			expect(secondResult.success).toBe("export const answer = 42;\n");
		}

		const cachedResult = await runResult(cache.getFileContent("src/app.ts", "/repo"));
		expect(Result.isSuccess(cachedResult)).toBe(true);
		if (Result.isSuccess(cachedResult)) {
			expect(cachedResult.success).toBe("export const answer = 42;\n");
		}
		expect(fetchCount).toBe(1);
	});

	it("shares in-flight diff reads for the same file", async () => {
		const deferred = createDeferred<{
			oldContent: string | null;
			newContent: string;
			fileName: string;
		}>();
		let fetchCount = 0;
		const cache = createFileContentCache({ fetchFileDiff });
		function fetchFileDiff() {
			fetchCount += 1;
			return fromPromise(() => deferred.promise, toUnknownError);
		}

		const first = cache.getFileDiff("src/app.ts", "/repo");
		const second = cache.getFileDiff("src/app.ts", "/repo");

		expect(fetchCount).toBe(1);
		deferred.resolve({
			oldContent: "old",
			newContent: "new",
			fileName: "app.ts",
		});

		const firstResult = await runResult(first);
		const secondResult = await runResult(second);
		expect(Result.isSuccess(firstResult)).toBe(true);
		expect(Result.isSuccess(secondResult)).toBe(true);
		if (Result.isSuccess(firstResult) && Result.isSuccess(secondResult)) {
			expect(firstResult.success).toEqual({
				oldContent: "old",
				newContent: "new",
				fileName: "app.ts",
			});
			expect(secondResult.success).toEqual({
				oldContent: "old",
				newContent: "new",
				fileName: "app.ts",
			});
		}

		const cachedResult = await runResult(cache.getFileDiff("src/app.ts", "/repo"));
		expect(Result.isSuccess(cachedResult)).toBe(true);
		if (Result.isSuccess(cachedResult)) {
			expect(cachedResult.success).toEqual({
				oldContent: "old",
				newContent: "new",
				fileName: "app.ts",
			});
		}
		expect(fetchCount).toBe(1);
	});

	it("can synchronously peek cached file content after a successful load", async () => {
		const cache = createFileContentCache({
			fetchFileContent: () => fromPromise(() => Promise.resolve("cached body"), toUnknownError),
		});

		expect(cache.peekFileContent("src/app.ts", "/repo")).toBeNull();

		const result = await runResult(cache.getFileContent("src/app.ts", "/repo"));
		expect(Result.isSuccess(result)).toBe(true);
		expect(cache.peekFileContent("src/app.ts", "/repo")).toBe("cached body");
	});
});
