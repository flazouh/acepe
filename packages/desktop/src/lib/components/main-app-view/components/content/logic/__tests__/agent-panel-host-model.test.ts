import { describe, expect, it } from "bun:test";
import type { Project } from "$lib/acp/logic/project-manager.svelte.js";
import type { Panel, PanelHotState } from "$lib/acp/store/types.js";
import { DEFAULT_PANEL_HOT_STATE } from "$lib/acp/store/types.js";
import {
	buildAgentPanelHostModel,
	resolveAgentPanelHostProjectPath,
	resolveAgentPanelHostSelectedAgentId,
} from "../agent-panel-host-model.js";

function createPanel(overrides?: Partial<Panel>): Panel {
	return {
		id: "panel-1",
		kind: "agent",
		ownerPanelId: null,
		sessionId: null,
		width: 480,
		pendingProjectSelection: false,
		pendingWorktreeEnabled: null,
		preparedWorktreeLaunch: null,
		selectedAgentId: "claude-code",
		projectPath: "/repo",
		agentId: null,
		sourcePath: null,
		worktreePath: null,
		sessionTitle: null,
		...overrides,
	};
}

function createHotState(overrides?: Partial<PanelHotState>): PanelHotState {
	return {
		...DEFAULT_PANEL_HOT_STATE,
		...overrides,
	};
}

function createProject(path = "/repo"): Project {
	return {
		path,
		name: "Repo",
		createdAt: new Date(0),
		color: "#123456",
		iconPath: null,
	};
}

describe("agent panel host model", () => {
	it("uses panel project path before a session exists", () => {
		expect(resolveAgentPanelHostProjectPath(createPanel({ sessionId: null }), undefined)).toBe(
			"/repo"
		);
	});

	it("prefers canonical session identity project path for existing sessions", () => {
		expect(
			resolveAgentPanelHostProjectPath(createPanel({ sessionId: "session-1" }), {
				id: "session-1",
				projectPath: "/canonical-repo",
				agentId: "claude-code",
			})
		).toBe("/canonical-repo");
	});

	it("falls back to panel project path while a session identity is still loading", () => {
		expect(
			resolveAgentPanelHostProjectPath(createPanel({ sessionId: "session-1" }), undefined)
		).toBe("/repo");
	});

	it("uses selected agent before a session exists", () => {
		expect(
			resolveAgentPanelHostSelectedAgentId({
				panel: createPanel({ sessionId: null, selectedAgentId: "cursor" }),
				sessionIdentity: undefined,
				availableAgents: [{ id: "cursor" }],
			})
		).toBe("cursor");
	});

	it("falls back to the visible first agent before a session exists", () => {
		expect(
			resolveAgentPanelHostSelectedAgentId({
				panel: createPanel({ sessionId: null, selectedAgentId: null }),
				sessionIdentity: undefined,
				availableAgents: [{ id: "claude-code" }, { id: "copilot" }],
			})
		).toBe("claude-code");
	});

	it("prefers canonical session identity agent for existing sessions", () => {
		expect(
			resolveAgentPanelHostSelectedAgentId({
				panel: createPanel({
					sessionId: "session-1",
					agentId: "panel-agent",
					selectedAgentId: "selected-agent",
				}),
				sessionIdentity: {
					id: "session-1",
					projectPath: "/repo",
					agentId: "canonical-agent",
				},
				availableAgents: [{ id: "canonical-agent" }, { id: "selected-agent" }],
			})
		).toBe("canonical-agent");
	});

	it("hides unavailable configured agents", () => {
		expect(
			resolveAgentPanelHostSelectedAgentId({
				panel: createPanel({ sessionId: null, selectedAgentId: "missing-agent" }),
				sessionIdentity: undefined,
				availableAgents: [{ id: "claude-code" }],
			})
		).toBeNull();
	});

	it("builds waiting state from explicit inputs", () => {
		const model = buildAgentPanelHostModel({
			panel: createPanel({ sessionId: "session-1" }),
			sessionIdentity: undefined,
			projects: [createProject()],
			availableAgents: [{ id: "claude-code" }],
			hotState: createHotState(),
		});

		expect(model.project?.path).toBe("/repo");
		expect(model.selectedAgentId).toBe("claude-code");
		expect(model.isWaitingForSession).toBe(true);
	});
});
