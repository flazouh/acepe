import { afterEach, describe, expect, it, vi } from "vitest";

import {
	PanelAgentState,
	type PanelAgentStateDeps,
	type SessionIdentitySlice,
	type SessionMetadataSlice,
} from "../panel-agent-state.svelte.js";
import type { Panel, WorkspacePanel } from "../types.js";

function createAgentState(
	overrides?: Partial<PanelAgentStateDeps>
): {
	state: PanelAgentState;
	workspacePanels: WorkspacePanel[];
	resolveCanonicalSessionId: ReturnType<typeof vi.fn>;
} {
	let workspacePanels: WorkspacePanel[] = [];
	const resolveCanonicalSessionId = vi.fn(() => null as string | null);
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
		resolveCanonicalSessionId,
		focusOpenedTopLevelPanel: () => {},
		onSpawnedPanelFocused: () => {},
		onExistingSessionOpened: () => {},
		clearAutoSessionSuppression: () => {},
		onPersist: () => {},
	};

	const state = new PanelAgentState({ ...deps, ...overrides });
	return { state, workspacePanels, resolveCanonicalSessionId };
}

function seedSession(
	sessionIdentityById: Map<string, SessionIdentitySlice>,
	sessionMetadataById: Map<string, SessionMetadataSlice>,
	sessionId: string
): void {
	sessionIdentityById.set(sessionId, {
		agentId: "claude-code",
		projectPath: "/tmp/project",
		worktreePath: null,
	});
	sessionMetadataById.set(sessionId, {
		sourcePath: null,
		title: "Session",
		sequenceId: 1,
	});
}

afterEach(() => {
	vi.useRealTimers();
});

describe("panel open canonical dedup", () => {
	it("focuses incumbent when opening alias while canonical panel is open", () => {
		const sessionIdentityById = new Map<string, SessionIdentitySlice>();
		const sessionMetadataById = new Map<string, SessionMetadataSlice>();
		seedSession(sessionIdentityById, sessionMetadataById, "C");

		const { state, resolveCanonicalSessionId } = createAgentState({
			getSessionIdentity: (sessionId) => sessionIdentityById.get(sessionId),
			getSessionMetadata: (sessionId) => sessionMetadataById.get(sessionId),
		});

		resolveCanonicalSessionId.mockImplementation((requestedId: string) =>
			requestedId === "A" ? "C" : requestedId === "C" ? "C" : null
		);

		const first = state.openSession("C", 420);
		expect(first).not.toBeNull();
		expect(state.panelCount).toBe(1);

		const second = state.openSession("A", 420);
		expect(second?.id).toBe(first?.id);
		expect(state.panelCount).toBe(1);
	});

	it("focuses incumbent when opening canonical twice", () => {
		const sessionIdentityById = new Map<string, SessionIdentitySlice>();
		const sessionMetadataById = new Map<string, SessionMetadataSlice>();
		seedSession(sessionIdentityById, sessionMetadataById, "C");

		const { state, resolveCanonicalSessionId } = createAgentState({
			getSessionIdentity: (sessionId) => sessionIdentityById.get(sessionId),
			getSessionMetadata: (sessionId) => sessionMetadataById.get(sessionId),
		});
		resolveCanonicalSessionId.mockImplementation((requestedId: string) =>
			requestedId === "C" ? "C" : null
		);

		const first = state.openSession("C", 420);
		const second = state.openSession("C", 420);
		expect(second?.id).toBe(first?.id);
		expect(state.panelCount).toBe(1);
	});

	it("spawns exactly one panel for a genuinely new id", () => {
		const { state, resolveCanonicalSessionId } = createAgentState();
		resolveCanonicalSessionId.mockReturnValue(null);

		const opened = state.openSession("new-session", 420);
		expect(opened).not.toBeNull();
		expect(state.panelCount).toBe(1);
	});

	it("materializeSessionPanel returns incumbent for alias while canonical is open", () => {
		const sessionIdentityById = new Map<string, SessionIdentitySlice>();
		const sessionMetadataById = new Map<string, SessionMetadataSlice>();
		seedSession(sessionIdentityById, sessionMetadataById, "C");

		const { state, resolveCanonicalSessionId } = createAgentState({
			getSessionIdentity: (sessionId) => sessionIdentityById.get(sessionId),
			getSessionMetadata: (sessionId) => sessionMetadataById.get(sessionId),
		});
		resolveCanonicalSessionId.mockImplementation((requestedId: string) =>
			requestedId === "A" ? "C" : requestedId === "C" ? "C" : null
		);

		const incumbent = state.openSession("C", 420);
		const materialized = state.materializeSessionPanel("A", 420);
		expect(materialized?.id).toBe(incumbent?.id);
		expect(state.panelCount).toBe(1);
	});

	it("does not spawn a second panel while canonical open is in-flight", async () => {
		vi.useFakeTimers();
		const sessionIdentityById = new Map<string, SessionIdentitySlice>();
		const sessionMetadataById = new Map<string, SessionMetadataSlice>();
		seedSession(sessionIdentityById, sessionMetadataById, "C");

		const { state, resolveCanonicalSessionId } = createAgentState({
			getSessionIdentity: (sessionId) => sessionIdentityById.get(sessionId),
			getSessionMetadata: (sessionId) => sessionMetadataById.get(sessionId),
		});
		resolveCanonicalSessionId.mockImplementation((requestedId: string) =>
			requestedId === "A" ? "C" : requestedId === "C" ? "C" : null
		);

		const first = state.openSession("C", 420);
		expect(first).not.toBeNull();

		const concurrent = state.openSession("A", 420);
		expect(concurrent?.id).toBe(first?.id);
		expect(state.panelCount).toBe(1);

		vi.runAllTimers();
	});
});
