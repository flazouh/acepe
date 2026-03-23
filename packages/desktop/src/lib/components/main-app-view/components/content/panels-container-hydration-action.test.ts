import { describe, expect, it } from "bun:test";

import { deriveRestoredPanelHydrationAction } from "./panels-container-hydration-action.js";

describe("deriveRestoredPanelHydrationAction", () => {
	it("returns load_missing when session is absent and panel has context", () => {
		const action = deriveRestoredPanelHydrationAction({
			sessionId: "session-1",
			panelProjectPath: "/workspace/project",
			panelAgentId: "codex",
			hasSessionInStore: false,
			isPreloaded: false,
			hotStatus: null,
		});

		expect(action).toEqual({
			type: "load_missing",
			projectPath: "/workspace/project",
			agentId: "codex",
		});
	});

	it("returns none when session is absent and panel context is incomplete", () => {
		const action = deriveRestoredPanelHydrationAction({
			sessionId: "session-1",
			panelProjectPath: null,
			panelAgentId: "codex",
			hasSessionInStore: false,
			isPreloaded: false,
			hotStatus: null,
		});

		expect(action).toEqual({ type: "none" });
	});

	it("returns preload when session exists but entries are not preloaded", () => {
		const action = deriveRestoredPanelHydrationAction({
			sessionId: "session-1",
			panelProjectPath: "/workspace/project",
			panelAgentId: "codex",
			hasSessionInStore: true,
			isPreloaded: false,
			hotStatus: "idle",
		});

		expect(action).toEqual({ type: "preload" });
	});

	it("returns none when session is preloaded", () => {
		const action = deriveRestoredPanelHydrationAction({
			sessionId: "session-1",
			panelProjectPath: "/workspace/project",
			panelAgentId: "codex",
			hasSessionInStore: true,
			isPreloaded: true,
			hotStatus: "idle",
		});

		expect(action).toEqual({ type: "none" });
	});

	it("returns none when session is currently loading", () => {
		const action = deriveRestoredPanelHydrationAction({
			sessionId: "session-1",
			panelProjectPath: "/workspace/project",
			panelAgentId: "codex",
			hasSessionInStore: true,
			isPreloaded: false,
			hotStatus: "loading",
		});

		expect(action).toEqual({ type: "none" });
	});
});
