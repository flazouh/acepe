import { describe, expect, test } from "bun:test";
import {
	getReadExpansionStorageKey,
	getReadFileName,
	getReadHeaderLabel,
	hasReadSourceBody,
	hasReadSourceExcerptHtml,
	isReadPending,
	READ_EXPANSION_STORAGE_PREFIX,
} from "./agent-tool-read-state.js";

describe("agent tool read state", () => {
	test("detects pending read statuses", () => {
		expect(isReadPending("pending")).toBe(true);
		expect(isReadPending("running")).toBe(true);
		expect(isReadPending("done")).toBe(false);
	});

	test("chooses header label from status", () => {
		const labels = { runningLabel: "Reading", doneLabel: "Read" };

		expect(getReadHeaderLabel("pending", labels)).toBe("Reading");
		expect(getReadHeaderLabel("running", labels)).toBe("Reading");
		expect(getReadHeaderLabel("done", labels)).toBe("Read");
		expect(getReadHeaderLabel("error", labels)).toBe("Read");
	});

	test("uses explicit file name before deriving one from path", () => {
		expect(
			getReadFileName({
				filePath: "/repo/src/app.ts",
				fileName: "custom.ts",
			})
		).toBe("custom.ts");
		expect(getReadFileName({ filePath: "/repo/src/app.ts" })).toBe("app.ts");
		expect(getReadFileName({ filePath: null })).toBeNull();
	});

	test("detects highlighted source html", () => {
		expect(hasReadSourceExcerptHtml("<span>code</span>")).toBe(true);
		expect(hasReadSourceExcerptHtml("")).toBe(false);
		expect(hasReadSourceExcerptHtml(null)).toBe(false);
	});

	test("detects whether read body should render", () => {
		expect(hasReadSourceBody({ sourceRangeLabel: "Lines 1-2" })).toBe(true);
		expect(hasReadSourceBody({ sourceExcerpt: "const x = 1;" })).toBe(true);
		expect(hasReadSourceBody({ sourceRangeLabel: null, sourceExcerpt: null })).toBe(
			false
		);
	});

	test("builds stable expansion storage keys", () => {
		expect(
			getReadExpansionStorageKey({
				toolCallId: "tool-1",
				filePath: "/repo/src/app.ts",
			})
		).toBe(`${READ_EXPANSION_STORAGE_PREFIX}tool-1`);
		expect(getReadExpansionStorageKey({ filePath: "/repo/src/app.ts" })).toBe(
			`${READ_EXPANSION_STORAGE_PREFIX}/repo/src/app.ts`
		);
		expect(getReadExpansionStorageKey({})).toBeNull();
	});
});
