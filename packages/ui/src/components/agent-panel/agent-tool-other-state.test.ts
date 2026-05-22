import { describe, expect, test } from "bun:test";
import {
	getOtherToolDetailsPreview,
	hasOtherToolDetails,
	OTHER_TOOL_PREVIEW_LIMIT,
} from "./agent-tool-other-state.js";

describe("agent tool other state", () => {
	test("detects non-empty details text", () => {
		expect(hasOtherToolDetails(" payload ")).toBe(true);
		expect(hasOtherToolDetails("   ")).toBe(false);
		expect(hasOtherToolDetails(null)).toBe(false);
		expect(hasOtherToolDetails(undefined)).toBe(false);
	});

	test("creates compact details previews", () => {
		expect(getOtherToolDetailsPreview("alpha\n\n beta\tgamma")).toBe(
			"alpha beta gamma"
		);
		expect(getOtherToolDetailsPreview("   ")).toBeNull();
		expect(getOtherToolDetailsPreview(null)).toBeNull();
	});

	test("truncates long details previews", () => {
		const longText = "x".repeat(OTHER_TOOL_PREVIEW_LIMIT + 5);

		expect(getOtherToolDetailsPreview(longText)).toBe(
			`${"x".repeat(OTHER_TOOL_PREVIEW_LIMIT)}...`
		);
	});
});
