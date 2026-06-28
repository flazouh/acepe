import { describe, expect, it } from "vitest";

import {
	SESSION_PROJECT_BADGE_CLASS,
	SESSION_PROJECT_BADGE_SIZE,
	shouldShowSessionProjectBadge,
} from "./project-letter-badge-session.js";

describe("shouldShowSessionProjectBadge", () => {
	it("requires sequenceId, projectName, and projectColor", () => {
		expect(
			shouldShowSessionProjectBadge({
				sequenceId: 3,
				projectName: "acepe",
				projectColor: "#FF5D5A",
			})
		).toBe(true);
	});

	it("returns false when sequenceId is missing", () => {
		expect(
			shouldShowSessionProjectBadge({
				sequenceId: null,
				projectName: "acepe",
				projectColor: "#FF5D5A",
			})
		).toBe(false);
	});

	it("returns false when project identity is incomplete", () => {
		expect(
			shouldShowSessionProjectBadge({
				sequenceId: 1,
				projectName: null,
				projectColor: "#FF5D5A",
			})
		).toBe(false);
		expect(
			shouldShowSessionProjectBadge({
				sequenceId: 1,
				projectName: "acepe",
				projectColor: null,
			})
		).toBe(false);
	});
});

describe("session project badge constants", () => {
	it("matches sidebar session item styling", () => {
		expect(SESSION_PROJECT_BADGE_SIZE).toBe(12);
		expect(SESSION_PROJECT_BADGE_CLASS).toBe("font-mono");
	});
});
