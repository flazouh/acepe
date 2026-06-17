import { describe, expect, it, vi } from "vitest";

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
		sessionId: "C",
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
	disposedPanelIds: string[];
	sessionIdentityById: Map<string, SessionIdentitySlice>;
	sessionMetadataById: Map<string, SessionMetadataSlice>;
} {
	let workspacePanels: WorkspacePanel[] = [];
	const disposedPanelIds: string[] = [];
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
		resolveCanonicalSessionId: (requestedId) => (requestedId === "C" ? "C" : null),
		focusOpenedTopLevelPanel: () => {},
		onSpawnedPanelFocused: () => {},
		onExistingSessionOpened: () => {},
		onDuplicatePanelDisposed: (panelId) => {
			disposedPanelIds.push(panelId);
		},
		clearAutoSessionSuppression: () => {},
		onPersist: () => {},
	};

	const state = new PanelAgentState({ ...deps, ...overrides });
	return { state, disposedPanelIds, sessionIdentityById, sessionMetadataById };
}

function seedCanonicalSession(
	sessionIdentityById: Map<string, SessionIdentitySlice>,
	sessionMetadataById: Map<string, SessionMetadataSlice>
): void {
	sessionIdentityById.set("C", {
		agentId: "claude-code",
		projectPath: "/tmp/project",
		worktreePath: null,
	});
	sessionMetadataById.set("C", {
		sourcePath: null,
		title: "Canonical",
		sequenceId: 7,
	});
}

describe("panel bind uniqueness", () => {
	it("collapses updatePanelSession when canonical is already held", () => {
		const { state, sessionIdentityById, sessionMetadataById } = createAgentState();
		seedCanonicalSession(sessionIdentityById, sessionMetadataById);

		state.panels = [
			createPanel({ id: "panel-a", sessionId: "C" }),
			createPanel({ id: "panel-2", sessionId: "A" }),
		];

		state.updatePanelSession("panel-2", "C");

		expect(state.panelCount).toBe(1);
		expect(state.getTopLevelAgentPanel("panel-a")?.sessionId).toBe("C");
		expect(state.getPanelBySessionId("C")?.id).toBe("panel-a");
		expect(state.getTopLevelAgentPanel("panel-2")).toBeUndefined();
	});

	it("collapses hydrator-style rebind onto incumbent", () => {
		const { state, disposedPanelIds, sessionIdentityById, sessionMetadataById } =
			createAgentState();
		seedCanonicalSession(sessionIdentityById, sessionMetadataById);

		state.panels = [createPanel({ id: "panel-a", sessionId: "C" })];
		const duplicate = createPanel({ id: "panel-2", sessionId: "A" });
		state.panels = [duplicate, ...state.panels];

		state.updatePanelSession("panel-2", "C");

		expect(state.panelCount).toBe(1);
		expect(disposedPanelIds).toEqual(["panel-2"]);
		expect(state.getPanelBySessionId("C")?.id).toBe("panel-a");
	});

	it("collapse disposal does not invoke disconnect callbacks", () => {
		const disconnect = vi.fn();
		const { state, sessionIdentityById, sessionMetadataById } = createAgentState({
			onDuplicatePanelDisposed: (panelId) => {
				disconnect(panelId);
			},
		});
		seedCanonicalSession(sessionIdentityById, sessionMetadataById);

		state.panels = [
			createPanel({ id: "panel-a", sessionId: "C" }),
			createPanel({ id: "panel-2", sessionId: "A" }),
		];

		state.updatePanelSession("panel-2", "C");

		expect(disconnect).toHaveBeenCalledTimes(1);
		expect(disconnect).toHaveBeenCalledWith("panel-2");
		expect(state.panelCount).toBe(1);
	});

	it("collapses materializeSessionPanel when canonical is already held", () => {
		const { state, sessionIdentityById, sessionMetadataById } = createAgentState();
		seedCanonicalSession(sessionIdentityById, sessionMetadataById);

		state.panels = [createPanel({ id: "panel-a", sessionId: "C" })];

		const materialized = state.materializeSessionPanel("C", 420);
		expect(materialized?.id).toBe("panel-a");
		expect(state.panelCount).toBe(1);
	});

	it("leaves one panel after collapse and removeAgentPanel on survivor is clean", () => {
		const { state, sessionIdentityById, sessionMetadataById } = createAgentState();
		seedCanonicalSession(sessionIdentityById, sessionMetadataById);

		state.panels = [
			createPanel({ id: "panel-a", sessionId: "C" }),
			createPanel({ id: "panel-2", sessionId: "A" }),
		];
		state.updatePanelSession("panel-2", "C");

		const removed = state.removeAgentPanel("panel-a");
		expect(removed?.id).toBe("panel-a");
		expect(state.panelCount).toBe(0);
		expect(state.getPanelBySessionId("C")).toBeUndefined();
	});
});
