import { describe, expect, it } from "vitest";

import type { SessionEntry } from "$lib/acp/application/dto/session.js";
import { deriveAgentPanelHeaderDisplayTitle } from "../agent-panel-header-title.js";

function userEntry(content: string): SessionEntry {
	const textBlock = { type: "text" as const, text: content };

	return {
		id: "user-1",
		type: "user",
		message: {
			content: textBlock,
			chunks: [textBlock],
		},
	};
}

describe("deriveAgentPanelHeaderDisplayTitle", () => {
	it("uses the backend session title without deriving from transcript entries", () => {
		const displayTitle = deriveAgentPanelHeaderDisplayTitle({
			sessionTitle: "Session 12ab5783",
			projectName: "acepe",
			sessionEntries: [userEntry("diagnostic ping - reply with ok")],
		});

		expect(displayTitle).toBe("Session 12ab5783");
	});
});
