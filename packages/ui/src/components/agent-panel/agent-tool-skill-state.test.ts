import { describe, expect, test } from "bun:test";
import {
	getSkillDisplayArgs,
	getSkillDisplayName,
	getSkillViewState,
	hasSkillDescription,
	isSkillPending,
	isSkillSuccess,
	SKILL_ARGS_PREVIEW_LIMIT,
} from "./agent-tool-skill-state.js";

describe("agent tool skill state", () => {
	test("detects pending and success statuses", () => {
		expect(isSkillPending("pending")).toBe(true);
		expect(isSkillPending("running")).toBe(true);
		expect(isSkillPending("done")).toBe(false);
		expect(isSkillSuccess("done")).toBe(true);
		expect(isSkillSuccess("running")).toBe(false);
	});

	test("detects non-empty descriptions", () => {
		expect(hasSkillDescription(" research notes ")).toBe(true);
		expect(hasSkillDescription("   ")).toBe(false);
		expect(hasSkillDescription(null)).toBe(false);
	});

	test("formats display name with slash prefix", () => {
		expect(getSkillDisplayName("research")).toBe("/research");
		expect(getSkillDisplayName(null)).toBeNull();
		expect(getSkillDisplayName(undefined)).toBeNull();
	});

	test("truncates long skill args for the header", () => {
		const longArgs = "x".repeat(SKILL_ARGS_PREVIEW_LIMIT + 3);

		expect(getSkillDisplayArgs("short args")).toBe("short args");
		expect(getSkillDisplayArgs(longArgs)).toBe(
			`${"x".repeat(SKILL_ARGS_PREVIEW_LIMIT)}...`
		);
		expect(getSkillDisplayArgs(null)).toBeNull();
		expect(getSkillDisplayArgs(undefined)).toBeUndefined();
	});

	test("builds loading fallback state while skill name is missing", () => {
		expect(
			getSkillViewState({
				status: "running",
				skillName: null,
				description: null,
			})
		).toEqual({
			isPending: true,
			isSuccess: false,
			hasDescription: false,
			hasContent: false,
			showLoadingFallback: true,
			showMissingNameFallback: false,
		});
	});

	test("builds missing name fallback state after running finishes", () => {
		expect(
			getSkillViewState({
				status: "done",
				skillName: null,
				description: null,
			})
		).toEqual({
			isPending: false,
			isSuccess: true,
			hasDescription: false,
			hasContent: false,
			showLoadingFallback: false,
			showMissingNameFallback: true,
		});
	});

	test("builds normal named skill state with content", () => {
		expect(
			getSkillViewState({
				status: "done",
				skillName: "commit",
				description: "Create a commit",
			})
		).toEqual({
			isPending: false,
			isSuccess: true,
			hasDescription: true,
			hasContent: true,
			showLoadingFallback: false,
			showMissingNameFallback: false,
		});
	});
});
