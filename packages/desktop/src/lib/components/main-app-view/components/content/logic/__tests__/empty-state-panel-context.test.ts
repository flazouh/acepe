import { describe, expect, it, mock } from "bun:test";

import {
	attachSessionToEmptyStatePanel,
	ensureEmptyStatePanelContext,
} from "../empty-state-panel-context.js";

describe("empty-state panel context", () => {
	it("pre-spawns a panel with stable id, project, and agent before first send", () => {
		const panelStore = {
			panels: [],
			spawnPanel: mock(() => ({ id: "empty-state-panel" })),
			setPanelAgent: mock(() => {}),
			setPanelProjectPath: mock(() => {}),
			updatePanelSession: mock(() => {}),
		};

		ensureEmptyStatePanelContext({
			panelStore,
			panelId: "empty-state-panel",
			projectPath: "/repo",
			selectedAgentId: "claude-code",
		});

		expect(panelStore.spawnPanel).toHaveBeenCalledWith({
			requireProjectSelection: false,
			projectPath: "/repo",
			id: "empty-state-panel",
			selectedAgentId: "claude-code",
		});
		expect(panelStore.setPanelProjectPath).not.toHaveBeenCalled();
		expect(panelStore.setPanelAgent).not.toHaveBeenCalled();
	});

	it("reuses existing panel context instead of spawning another panel", () => {
		const panelStore = {
			panels: [{ id: "empty-state-panel" }],
			spawnPanel: mock(() => ({ id: "empty-state-panel" })),
			setPanelAgent: mock(() => {}),
			setPanelProjectPath: mock(() => {}),
			updatePanelSession: mock(() => {}),
		};

		ensureEmptyStatePanelContext({
			panelStore,
			panelId: "empty-state-panel",
			projectPath: "/repo",
			selectedAgentId: "claude-code",
		});

		expect(panelStore.spawnPanel).not.toHaveBeenCalled();
		expect(panelStore.setPanelProjectPath).toHaveBeenCalledWith("empty-state-panel", "/repo");
		expect(panelStore.setPanelAgent).toHaveBeenCalledWith("empty-state-panel", "claude-code");
	});

	it("attaches created session to the pre-spawned panel", () => {
		const panelStore = {
			panels: [{ id: "empty-state-panel" }],
			spawnPanel: mock(() => ({ id: "empty-state-panel" })),
			setPanelAgent: mock(() => {}),
			setPanelProjectPath: mock(() => {}),
			updatePanelSession: mock(() => {}),
		};

		const attached = attachSessionToEmptyStatePanel({
			panelStore,
			panelId: "empty-state-panel",
			sessionId: "session-1",
		});

		expect(attached).toBe(true);
		expect(panelStore.updatePanelSession).toHaveBeenCalledWith("empty-state-panel", "session-1");
	});
});
