import { describe, expect, it } from "bun:test";

import { KANBAN_SESSION_PANEL_WIDTH } from "./kanban-session-panel-width.js";

describe("KANBAN_SESSION_PANEL_WIDTH", () => {
	it("opens kanban sessions at 600px width", () => {
		expect(KANBAN_SESSION_PANEL_WIDTH).toBe(600);
	});
});
