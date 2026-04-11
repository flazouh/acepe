/**
 * Panel View State Tests
 *
 * Tests the panel-level view state derivation that combines
 * session runtime state, entry count, error info, and agent selection
 * into a single discriminated union — exactly one UI section to show.
 */

import { describe, expect, it } from "vitest";

import type { PanelErrorInfo } from "../../components/agent-panel/logic/connection-ui";
import { derivePanelViewState } from "../panel-visibility";
import type { SessionRuntimeState } from "../session-ui-state";

function makeRuntimeState(overrides: Partial<SessionRuntimeState> = {}): SessionRuntimeState {
	return {
		connectionPhase: "connected",
		contentPhase: "loaded",
		activityPhase: "idle",
		canSubmit: true,
		canCancel: false,
		showStop: false,
		showThinking: false,
		showConnectingOverlay: false,
		showConversation: true,
		showReadyPlaceholder: false,
		...overrides,
	};
}

const NO_ERROR: PanelErrorInfo = { showError: false, details: null };
const HAS_ERROR: PanelErrorInfo = { showError: true, details: "Connection failed" };

function makeInput(overrides: Partial<Parameters<typeof derivePanelViewState>[0]> = {}) {
	return {
		runtimeState: makeRuntimeState(),
		entriesCount: 0,
		hasSession: true,
		showProjectSelection: false,
		hasEffectiveProjectPath: true,
		hasSelectedAgentId: true,
		hasAvailableAgents: false,
		errorInfo: NO_ERROR,
		...overrides,
	};
}

describe("derivePanelViewState", () => {
	// ── Priority 1: Project Selection ──────────────────────────

	it("should return project_selection when project selection is needed", () => {
		const result = derivePanelViewState(makeInput({ showProjectSelection: true }));
		expect(result.kind).toBe("project_selection");
	});

	it("should prioritize project_selection over error", () => {
		const result = derivePanelViewState(
			makeInput({ showProjectSelection: true, errorInfo: HAS_ERROR })
		);
		expect(result.kind).toBe("project_selection");
	});

	// ── Priority 2: Blocking Error ─────────────────────────────

	it("should return error when error with no entries", () => {
		const result = derivePanelViewState(makeInput({ errorInfo: HAS_ERROR, entriesCount: 0 }));
		expect(result.kind).toBe("error");
		if (result.kind === "error") {
			expect(result.details).toBe("Connection failed");
		}
	});

	it("should return error with fallback details when details is null", () => {
		const result = derivePanelViewState(
			makeInput({ errorInfo: { showError: true, details: null }, entriesCount: 0 })
		);
		expect(result.kind).toBe("error");
		if (result.kind === "error") {
			expect(result.details).toBeTypeOf("string");
			expect(result.details.length).toBeGreaterThan(0);
		}
	});

	// ── Session Creation: Ready (not connecting) ──────────────

	it("should return ready (not connecting) while session is being created", () => {
		const result = derivePanelViewState(makeInput({ runtimeState: null, hasSession: false }));
		expect(result.kind).toBe("ready");
	});

	it("should return conversation when entries exist even while session is being created", () => {
		const result = derivePanelViewState(
			makeInput({
				runtimeState: makeRuntimeState({ showConnectingOverlay: true }),
				entriesCount: 2,
			})
		);
		expect(result.kind).toBe("conversation");
	});

	it("should show ready when reconnecting — input stays available for message queue", () => {
		const result = derivePanelViewState(
			makeInput({
				runtimeState: makeRuntimeState({ showConnectingOverlay: true }),
				entriesCount: 0,
			})
		);
		expect(result.kind).toBe("ready");
	});

	// ── Priority 3: Conversation ───────────────────────────────

	it("should return conversation when there are entries", () => {
		const result = derivePanelViewState(makeInput({ entriesCount: 5 }));
		expect(result.kind).toBe("conversation");
	});

	it("should return conversation with null errorDetails when no error", () => {
		const result = derivePanelViewState(makeInput({ entriesCount: 5 }));
		expect(result.kind).toBe("conversation");
		if (result.kind === "conversation") {
			expect(result.errorDetails).toBeNull();
		}
	});

	it("should return conversation with errorDetails when error + entries (inline error)", () => {
		const result = derivePanelViewState(makeInput({ entriesCount: 3, errorInfo: HAS_ERROR }));
		expect(result.kind).toBe("conversation");
		if (result.kind === "conversation") {
			expect(result.errorDetails).toBe("Connection failed");
		}
	});

	it("should show conversation when entries exist during reconnection", () => {
		const result = derivePanelViewState(
			makeInput({
				runtimeState: makeRuntimeState({ showConnectingOverlay: true }),
				entriesCount: 3,
			})
		);
		expect(result.kind).toBe("conversation");
	});

	it("should show conversation when entries arrive before runtime updates", () => {
		const result = derivePanelViewState(
			makeInput({
				runtimeState: makeRuntimeState({
					showConversation: false,
					showReadyPlaceholder: true,
				}),
				entriesCount: 2,
			})
		);
		expect(result.kind).toBe("conversation");
	});

	// ── Bug fix regression: entries > 0 NEVER produces ready ───

	it("should never produce ready or project_selection when entries exist (bug fix)", () => {
		const configs = [
			makeInput({ entriesCount: 1 }),
			makeInput({ entriesCount: 1, runtimeState: null, hasSession: false }),
			makeInput({
				entriesCount: 1,
				runtimeState: makeRuntimeState({ showReadyPlaceholder: true }),
			}),
			makeInput({
				entriesCount: 10,
				runtimeState: makeRuntimeState({ showConversation: true }),
			}),
		];

		for (const input of configs) {
			const result = derivePanelViewState(input);
			expect(result.kind).not.toBe("ready");
			expect(result.kind).not.toBe("project_selection");
		}
	});

	// ── Project Selection (includes agent selection with embedded agents) ────

	it("should return project_selection when agents available but none selected (agents now embedded in project cards)", () => {
		const result = derivePanelViewState(
			makeInput({
				hasAvailableAgents: true,
				hasSelectedAgentId: false,
				hasSession: false,
				runtimeState: null,
			})
		);
		expect(result.kind).toBe("project_selection");
	});

	it("should not return project_selection for agent selection when an agent is already selected", () => {
		const result = derivePanelViewState(
			makeInput({
				hasAvailableAgents: true,
				hasSelectedAgentId: true,
				hasSession: false,
				runtimeState: null,
			})
		);
		expect(result.kind).not.toBe("project_selection");
	});

	it("should not return project_selection for existing sessions that already have an agent", () => {
		const result = derivePanelViewState(
			makeInput({
				hasAvailableAgents: true,
				hasSelectedAgentId: false,
				hasSession: true,
				runtimeState: makeRuntimeState({
					showConversation: false,
					showReadyPlaceholder: true,
				}),
				entriesCount: 0,
			})
		);
		expect(result.kind).toBe("ready");
	});

	it("should keep existing session conversations visible even when no draft agent is selected", () => {
		const result = derivePanelViewState(
			makeInput({
				hasAvailableAgents: true,
				hasSelectedAgentId: false,
				hasSession: true,
				entriesCount: 3,
			})
		);
		expect(result.kind).toBe("conversation");
	});

	// ── Priority 4: Ready ──────────────────────────────────────

	it("should return ready for new session with zero entries", () => {
		const result = derivePanelViewState(
			makeInput({
				runtimeState: makeRuntimeState({
					showConversation: true,
					showReadyPlaceholder: false,
				}),
				entriesCount: 0,
			})
		);
		expect(result.kind).toBe("ready");
	});

	it("should return ready when no session but has project and agent", () => {
		const result = derivePanelViewState(makeInput({ runtimeState: null, hasSession: false }));
		expect(result.kind).toBe("ready");
	});

	it("should return ready when runtime says ready and no entries", () => {
		const result = derivePanelViewState(
			makeInput({
				runtimeState: makeRuntimeState({
					showConversation: false,
					showReadyPlaceholder: true,
				}),
				entriesCount: 0,
			})
		);
		expect(result.kind).toBe("ready");
	});
});
