import { describe, expect, it } from "vitest";

import { deriveAgentPanelHeaderDisplayTitle } from "../agent-panel-header-title.js";

describe("deriveAgentPanelHeaderDisplayTitle", () => {
	it("uses the backend session title without deriving from transcript entries", () => {
		const displayTitle = deriveAgentPanelHeaderDisplayTitle({
			sessionTitle: "Session 12ab5783",
			projectName: "acepe",
		});

		expect(displayTitle).toBe("Session 12ab5783");
	});
});
