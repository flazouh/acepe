import { describe, expect, it } from "bun:test";

import {
	isSelectedProject,
	isSelectedSession,
} from "./library-sidebar-state.js";

describe("isSelectedProject", () => {
	it("is true only for the selected project id", () => {
		expect(
			isSelectedProject({
				projectId: "project-1",
				selectedProjectId: "project-1",
			}),
		).toBe(true);
		expect(
			isSelectedProject({
				projectId: "project-1",
				selectedProjectId: "project-2",
			}),
		).toBe(false);
		expect(
			isSelectedProject({
				projectId: "project-1",
				selectedProjectId: null,
			}),
		).toBe(false);
	});
});

describe("isSelectedSession", () => {
	it("is true only for the selected session id", () => {
		expect(
			isSelectedSession({
				sessionId: "session-1",
				selectedSessionId: "session-1",
			}),
		).toBe(true);
		expect(
			isSelectedSession({
				sessionId: "session-1",
				selectedSessionId: "session-2",
			}),
		).toBe(false);
		expect(
			isSelectedSession({
				sessionId: "session-1",
				selectedSessionId: null,
			}),
		).toBe(false);
	});
});
