import { describe, expect, it } from "bun:test";
import { ResultAsync } from "neverthrow";

import { createFileContentCache } from "./file-content-cache.svelte.js";

function createDeferred<T>() {
	let resolve!: (value: T) => void;
	const promise = new Promise<T>((nextResolve) => {
		resolve = nextResolve;
	});
	return { promise, resolve };
}

describe("fileContentCache", () => {
	it("shares in-flight file content reads for the same file", async () => {
		const deferred = createDeferred<string>();
		let fetchCount = 0;
		const cache = createFileContentCache({ fetchFileContent });
		function fetchFileContent() {
			fetchCount += 1;
			return ResultAsync.fromPromise(deferred.promise, (error) => error);
		}

		const first = cache.getFileContent("src/app.ts", "/repo");
		const second = cache.getFileContent("src/app.ts", "/repo");

		expect(fetchCount).toBe(1);
		deferred.resolve("export const answer = 42;\n");

		const firstResult = await first;
		const secondResult = await second;
		expect(firstResult.isOk()).toBe(true);
		expect(secondResult.isOk()).toBe(true);
		if (firstResult.isOk() && secondResult.isOk()) {
			expect(firstResult.value).toBe("export const answer = 42;\n");
			expect(secondResult.value).toBe("export const answer = 42;\n");
		}

		const cachedResult = await cache.getFileContent("src/app.ts", "/repo");
		expect(cachedResult.isOk()).toBe(true);
		if (cachedResult.isOk()) {
			expect(cachedResult.value).toBe("export const answer = 42;\n");
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
			return ResultAsync.fromPromise(deferred.promise, (error) => error);
		}

		const first = cache.getFileDiff("src/app.ts", "/repo");
		const second = cache.getFileDiff("src/app.ts", "/repo");

		expect(fetchCount).toBe(1);
		deferred.resolve({
			oldContent: "old",
			newContent: "new",
			fileName: "app.ts",
		});

		const firstResult = await first;
		const secondResult = await second;
		expect(firstResult.isOk()).toBe(true);
		expect(secondResult.isOk()).toBe(true);
		if (firstResult.isOk() && secondResult.isOk()) {
			expect(firstResult.value).toEqual({
				oldContent: "old",
				newContent: "new",
				fileName: "app.ts",
			});
			expect(secondResult.value).toEqual({
				oldContent: "old",
				newContent: "new",
				fileName: "app.ts",
			});
		}

		const cachedResult = await cache.getFileDiff("src/app.ts", "/repo");
		expect(cachedResult.isOk()).toBe(true);
		if (cachedResult.isOk()) {
			expect(cachedResult.value).toEqual({
				oldContent: "old",
				newContent: "new",
				fileName: "app.ts",
			});
		}
		expect(fetchCount).toBe(1);
	});

	it("can synchronously peek cached file content after a successful load", async () => {
		const cache = createFileContentCache({
			fetchFileContent: () => ResultAsync.fromPromise(Promise.resolve("cached body"), (error) => error),
		});

		expect(cache.peekFileContent("src/app.ts", "/repo")).toBeNull();

		const result = await cache.getFileContent("src/app.ts", "/repo");
		expect(result.isOk()).toBe(true);
		expect(cache.peekFileContent("src/app.ts", "/repo")).toBe("cached body");
	});
});
