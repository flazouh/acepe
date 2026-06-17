import { afterEach, describe, expect, it, vi } from "vitest";

import type { PreparedWorktreeLaunch } from "../../types/worktree-info.js";
import {
	PanelAgentState,
	type PanelAgentStateDeps,
	type SessionIdentitySlice,
	type SessionMetadataSlice,
} from "../panel-agent-state.svelte.js";
import type { Panel, WorkspacePanel } from "../types.js";

function createPanel(overrides?: Partial<Panel>): Panel {
	return {
		id: "panel-1",
		kind: "agent",
		ownerPanelId: null,
		sessionId: null,
		width: 400,
		pendingProjectSelection: false,
		pendingWorktreeEnabled: null,
		preparedWorktreeLaunch: null,
		selectedAgentId: "claude-code",
		projectPath: "/tmp/project",
		agentId: null,
		sourcePath: null,
		worktreePath: null,
		sessionTitle: null,
		autoCreated: false,
		...overrides,
	};
}

function createAgentState(
	overrides?: Partial<PanelAgentStateDeps>
): {
	state: PanelAgentState;
	workspacePanels: WorkspacePanel[];
	persist: ReturnType<typeof vi.fn>;
	sessionIdentityById: Map<string, SessionIdentitySlice>;
	sessionMetadataById: Map<string, SessionMetadataSlice>;
} {
	let workspacePanels: WorkspacePanel[] = [];
	const persist = vi.fn();
	const sessionIdentityById = new Map<string, SessionIdentitySlice>();
	const sessionMetadataById = new Map<string, SessionMetadataSlice>();

	const deps: PanelAgentStateDeps = {
		getWorkspacePanels: () => workspacePanels,
		replaceAgentPanelsInWorkspace: (nextAgentPanels) => {
			const remaining = workspacePanels.filter((panel) => panel.kind !== "agent");
			workspacePanels = [...nextAgentPanels, ...remaining];
		},
		insertAgentPanelInWorkspace: (panel, placement) => {
			workspacePanels =
				placement === "prepend" ? [panel, ...workspacePanels] : [...workspacePanels, panel];
		},
		patchAgentPanelInWorkspace: (panel) => {
			workspacePanels = workspacePanels.map((candidate) =>
				candidate.id === panel.id ? panel : candidate
			);
		},
		getSessionIdentity: (sessionId) => sessionIdentityById.get(sessionId),
		getSessionMetadata: (sessionId) => sessionMetadataById.get(sessionId),
		hasPendingCreationSession: () => false,
		resolveCanonicalSessionId: () => null,
		focusOpenedTopLevelPanel: () => {},
		onSpawnedPanelFocused: () => {},
		onExistingSessionOpened: () => {},
		clearAutoSessionSuppression: () => {},
		onPersist: () => {
			persist();
		},
	};

	const state = new PanelAgentState({ ...deps, ...overrides });
	return { state, workspacePanels, persist, sessionIdentityById, sessionMetadataById };
}

afterEach(() => {
	vi.useRealTimers();
});

describe("PanelAgentState", () => {
	it("opens a session and keeps byId and bySessionId indexes coherent", () => {
		const { state, sessionIdentityById, sessionMetadataById } = createAgentState();
		sessionIdentityById.set("session-1", {
			agentId: "claude-code",
			projectPath: "/tmp/project",
			worktreePath: null,
		});
		sessionMetadataById.set("session-1", {
			sourcePath: null,
			title: "Session One",
			sequenceId: 1,
		});

		const opened = state.openSession("session-1", 420);
		expect(opened).not.toBeNull();
		if (opened === null) return;

		expect(state.getTopLevelAgentPanel(opened.id)?.sessionId).toBe("session-1");
		expect(state.getPanelBySessionId("session-1")?.id).toBe(opened.id);
		expect(state.getTopLevelAgentPanelsForProject("/tmp/project")).toHaveLength(1);
		expect(state.panelCount).toBe(1);
	});

	it("removes a panel from all indexes on close", () => {
		const { state } = createAgentState();
		const panel = createPanel({ id: "panel-close", sessionId: "session-close" });
		state.panels = [panel];

		expect(state.getTopLevelAgentPanel("panel-close")).toBeDefined();
		expect(state.getPanelBySessionId("session-close")?.id).toBe("panel-close");

		const removed = state.removeAgentPanel("panel-close");
		expect(removed?.id).toBe("panel-close");
		expect(state.getTopLevelAgentPanel("panel-close")).toBeUndefined();
		expect(state.getPanelBySessionId("session-close")).toBeUndefined();
		expect(state.getTopLevelAgentPanelsForProject("/tmp/project")).toHaveLength(0);
		expect(state.panelCount).toBe(0);
	});

	it("remaps bySessionId when updatePanelSession changes the session id", () => {
		const { state, sessionIdentityById, sessionMetadataById } = createAgentState();
		const panel = createPanel({ id: "panel-remap", sessionId: "session-old" });
		state.panels = [panel];
		sessionIdentityById.set("session-new", {
			agentId: "claude-code",
			projectPath: "/tmp/project",
			worktreePath: "/tmp/project/.worktrees/wt-1",
		});
		sessionMetadataById.set("session-new", {
			sourcePath: "/tmp/project",
			title: "Remapped",
			sequenceId: 2,
		});

		state.updatePanelSession("panel-remap", "session-new");

		expect(state.getPanelBySessionId("session-old")).toBeUndefined();
		expect(state.getPanelBySessionId("session-new")?.id).toBe("panel-remap");
		expect(state.getTopLevelAgentPanel("panel-remap")?.worktreePath).toBe(
			"/tmp/project/.worktrees/wt-1"
		);
	});

	it("sets and clears worktree card fields on the panel object", () => {
		const { state, persist } = createAgentState();
		const panel = createPanel({ id: "panel-worktree" });
		state.panels = [panel];

		state.setPendingWorktreeEnabled("panel-worktree", true);
		expect(state.getTopLevelAgentPanel("panel-worktree")?.pendingWorktreeEnabled).toBe(true);

		const launch: PreparedWorktreeLaunch = {
			launchToken: "token-1",
			sequenceId: 7,
			worktree: {
				name: "clever-falcon",
				branch: "clever-falcon",
				directory: "/tmp/project/.worktrees/clever-falcon",
				origin: "acepe",
			},
		};
		state.setPreparedWorktreeLaunch("panel-worktree", launch);
		expect(state.getTopLevelAgentPanel("panel-worktree")?.preparedWorktreeLaunch).toEqual(launch);

		state.clearPreparedWorktreeLaunch("panel-worktree");
		expect(state.getTopLevelAgentPanel("panel-worktree")?.preparedWorktreeLaunch).toBeNull();
		expect(persist).toHaveBeenCalled();
	});
});
