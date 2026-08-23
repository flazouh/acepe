import { describe, expect, it } from "bun:test";
import { emptyRpcSessionSnapshot } from "@acepe/contracts";

import { settingsModalViewModel } from "./settings-state.ts";

describe("settingsModalViewModel", () => {
	it("maps projected font sizes onto the settings modal", () => {
		const empty = emptyRpcSessionSnapshot(0);
		const model = settingsModalViewModel({
			snapshot: {
				snapshotSequence: 4,
				session: empty.session,
				messages: empty.messages,
				turns: empty.turns,
				activities: empty.activities,
				pendingApprovals: empty.pendingApprovals,
				checkpoints: empty.checkpoints,
				projects: empty.projects,
				sessions: empty.sessions,
				settings: [
					{ key: "ui_font_size", value: "18", sequence: 3 },
					{ key: "code_font_size", value: "15", sequence: 4 },
				],
				skillsCatalog: empty.skillsCatalog,
				voice: empty.voice,
				gitReview: empty.gitReview,
			},
			open: true,
		});
		expect(model.open).toBe(true);
		expect(model.uiFontSize).toBe(18);
		expect(model.codeFontSize).toBe(15);
		expect(model.uiMin).toBe(12);
		expect(model.uiMax).toBe(20);
		expect(model.codeMin).toBe(10);
		expect(model.codeMax).toBe(18);
		expect(model.openLabel).toBe("Settings");
	});

	it("uses shipping defaults when the projection has no font rows", () => {
		const model = settingsModalViewModel({
			snapshot: emptyRpcSessionSnapshot(0),
			open: false,
		});
		expect(model.open).toBe(false);
		expect(model.uiFontSize).toBe(16);
		expect(model.codeFontSize).toBe(13);
	});
});
