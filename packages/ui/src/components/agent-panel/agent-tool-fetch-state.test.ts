import { describe, expect, test } from "bun:test";
import {
	getFetchResultLabel,
	getFetchResultPreview,
	getFetchTargetText,
	getFetchTitle,
	hasFetchResult,
	isFetchError,
	isFetchPending,
} from "./agent-tool-fetch-state.js";

const labels = {
	fetchingLabel: "Fetching",
	fetchFailedLabel: "Fetch failed",
	fetchedLabel: "Fetched",
};

describe("agent tool fetch state", () => {
	test("detects pending and error statuses", () => {
		expect(isFetchPending("pending")).toBe(true);
		expect(isFetchPending("running")).toBe(true);
		expect(isFetchPending("done")).toBe(false);
		expect(isFetchError("error")).toBe(true);
		expect(isFetchError("done")).toBe(false);
	});

	test("chooses title by status", () => {
		expect(getFetchTitle("pending", labels)).toBe("Fetching");
		expect(getFetchTitle("running", labels)).toBe("Fetching");
		expect(getFetchTitle("error", labels)).toBe("Fetch failed");
		expect(getFetchTitle("done", labels)).toBe("Fetched");
		expect(getFetchTitle("cancelled", labels)).toBe("Fetched");
	});

	test("prefers domain over url for target text", () => {
		expect(
			getFetchTargetText({
				domain: "example.com",
				url: "https://example.com/path",
			})
		).toBe("example.com");
		expect(getFetchTargetText({ url: "https://example.com/path" })).toBe(
			"https://example.com/path"
		);
		expect(getFetchTargetText({})).toBeNull();
	});

	test("detects visible result text", () => {
		expect(hasFetchResult(" result ")).toBe(true);
		expect(hasFetchResult("   ")).toBe(false);
		expect(hasFetchResult(null)).toBe(false);
	});

	test("creates compact result previews", () => {
		expect(getFetchResultPreview("hello\n\nworld")).toBe("hello world");
		expect(getFetchResultPreview("   ")).toBeNull();

		const longText = "x".repeat(130);
		expect(getFetchResultPreview(longText)).toBe(`${"x".repeat(120)}...`);
	});

	test("uses error label only for error status", () => {
		expect(
			getFetchResultLabel("error", {
				resultLabel: "Result",
				errorLabel: "Error",
			})
		).toBe("Error");
		expect(
			getFetchResultLabel("done", {
				resultLabel: "Result",
				errorLabel: "Error",
			})
		).toBe("Result");
	});
});
