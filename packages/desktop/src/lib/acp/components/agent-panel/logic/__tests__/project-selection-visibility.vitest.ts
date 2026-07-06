import { describe, expect, it } from "vitest";
import { shouldShowAgentPanelProjectSelection } from "../project-selection-visibility.js";

describe("shouldShowAgentPanelProjectSelection", () => {
	it("does not block an existing session while project metadata is still loading", () => {
		const visible = shouldShowAgentPanelProjectSelection({
			sessionId: "session-1",
			projectCount: 2,
			pendingProjectSelection: false,
			projectKnown: false,
		});

		expect(visible).toBe(false);
	});

	it("keeps pre-session project selection for multiple projects when no project is known", () => {
		const visible = shouldShowAgentPanelProjectSelection({
			sessionId: null,
			projectCount: 2,
			pendingProjectSelection: false,
			projectKnown: false,
		});

		expect(visible).toBe(true);
	});

	it("keeps explicit pre-session project selection requests", () => {
		const visible = shouldShowAgentPanelProjectSelection({
			sessionId: null,
			projectCount: 2,
			pendingProjectSelection: true,
			projectKnown: true,
		});

		expect(visible).toBe(true);
	});

	it("does not show project selection for a single-project pre-session panel", () => {
		const visible = shouldShowAgentPanelProjectSelection({
			sessionId: null,
			projectCount: 1,
			pendingProjectSelection: false,
			projectKnown: false,
		});

		expect(visible).toBe(false);
	});
});
