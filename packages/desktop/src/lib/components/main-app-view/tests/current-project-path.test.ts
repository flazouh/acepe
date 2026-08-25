import { describe, expect, it } from "vitest";

import { resolveCurrentProjectPath } from "../logic/current-project-path.ts";

describe("resolveCurrentProjectPath", () => {
	it("prefers the focused project view", () => {
		expect(
			resolveCurrentProjectPath({
				focusedViewProjectPath: "/repo/viewed",
				focusedPanelProjectPath: "/repo/panel",
				firstProjectPath: "/repo/first",
			})
		).toBe("/repo/viewed");
	});

	it("falls back to the focused panel's project", () => {
		expect(
			resolveCurrentProjectPath({
				focusedViewProjectPath: null,
				focusedPanelProjectPath: "/repo/panel",
				firstProjectPath: "/repo/first",
			})
		).toBe("/repo/panel");
	});

	it("falls back to the first project when nothing is focused", () => {
		expect(
			resolveCurrentProjectPath({
				focusedViewProjectPath: null,
				focusedPanelProjectPath: null,
				firstProjectPath: "/repo/first",
			})
		).toBe("/repo/first");
	});

	it("answers null when there is no project at all", () => {
		expect(
			resolveCurrentProjectPath({
				focusedViewProjectPath: null,
				focusedPanelProjectPath: null,
				firstProjectPath: null,
			})
		).toBeNull();
	});
});
