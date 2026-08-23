import { describe, expect, it } from "bun:test";

import { isSelectedProject, isSelectedSession } from "./index.js";

describe("library-sidebar exports", () => {
	it("exports the selected-project helper", () => {
		expect(
			isSelectedProject({
				projectId: "project-1",
				selectedProjectId: "project-1",
			}),
		).toBe(true);
	});

	it("exports the selected-session helper", () => {
		expect(
			isSelectedSession({
				sessionId: "session-1",
				selectedSessionId: "session-1",
			}),
		).toBe(true);
	});
});
