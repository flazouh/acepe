/**
 * Panel View State Tests
 *
 * Tests the panel-level view state derivation that combines
 * session lifecycle presentation, entry count, error info, and agent selection
 * into a single discriminated union — exactly one UI section to show.
 */

import { describe, expect, it } from "vitest";

import type { PanelErrorInfo } from "../../components/agent-panel/logic/connection-ui";
import { derivePanelViewState, type PanelLifecyclePresentation } from "../panel-visibility";

function makeLifecyclePresentation(
	overrides: Partial<PanelLifecyclePresentation> = {}
): PanelLifecyclePresentation {
	return {
		connectionPhase: overrides.connectionPhase ?? "connected",
		contentPhase: overrides.contentPhase ?? "loaded",
		showConversation: overrides.showConversation ?? true,
		showReadyPlaceholder: overrides.showReadyPlaceholder ?? false,
	};
}

const NO_ERROR: PanelErrorInfo = {
	showError: false,
	title: "Connection error",
	summary: null,
	details: null,
	referenceId: null,
	referenceSearchable: false,
	failureReason: null,
	recoveryAction: null,
};
const HAS_ERROR: PanelErrorInfo = {
	showError: true,
	title: "Connection error",
	summary: "Connection failed",
	details: "Connection failed",
	referenceId: null,
	referenceSearchable: false,
	failureReason: null,
	recoveryAction: null,
};

function makeInput(overrides: Partial<Parameters<typeof derivePanelViewState>[0]> = {}) {
	return {
		lifecyclePresentation:
			overrides.lifecyclePresentation === undefined
				? makeLifecyclePresentation()
				: overrides.lifecyclePresentation,
		entriesCount: overrides.entriesCount ?? 0,
		hasSession: overrides.hasSession ?? true,
		isAwaitingModelResponse: overrides.isAwaitingModelResponse ?? false,
		hasImmediatePendingSendIntent: overrides.hasImmediatePendingSendIntent ?? false,
		showProjectSelection: overrides.showProjectSelection ?? false,
		hasEffectiveProjectPath: overrides.hasEffectiveProjectPath ?? true,
		errorInfo: overrides.errorInfo ?? NO_ERROR,
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
			makeInput({
				errorInfo: {
					showError: true,
					title: "Connection error",
					summary: null,
					details: null,
					referenceId: null,
					referenceSearchable: false,
					failureReason: null,
					recoveryAction: null,
				},
				entriesCount: 0,
			})
		);
		expect(result.kind).toBe("error");
		if (result.kind === "error") {
			expect(result.details).toBeTypeOf("string");
			expect(result.details.length).toBeGreaterThan(0);
		}
	});

	it("should keep archived-session recovery in ready chrome when there are no entries", () => {
		const result = derivePanelViewState(
			makeInput({
				errorInfo: {
					showError: true,
					title: "Session archived",
					summary: null,
					details: null,
					referenceId: null,
					referenceSearchable: false,
					failureReason: "sessionArchivedUpstream",
					recoveryAction: "unarchive",
				},
				entriesCount: 0,
			})
		);

		expect(result.kind).toBe("ready");
	});

	it("should return ready while failed lifecycle content is still loading", () => {
		const result = derivePanelViewState(
			makeInput({
				entriesCount: 0,
				lifecyclePresentation: makeLifecyclePresentation({
					connectionPhase: "failed",
					contentPhase: "loading",
					showConversation: false,
					showReadyPlaceholder: false,
				}),
			})
		);

		expect(result.kind).toBe("ready");
	});

	it("should return error when lifecycle connection failed after content load resolves empty", () => {
		const result = derivePanelViewState(
			makeInput({
				entriesCount: 0,
				lifecyclePresentation: makeLifecyclePresentation({
					connectionPhase: "failed",
					contentPhase: "empty",
					showConversation: false,
					showReadyPlaceholder: false,
				}),
			})
		);

		expect(result.kind).toBe("error");
		if (result.kind === "error") {
			expect(result.details).toBe("Unable to connect to the agent.");
		}
	});

	// ── Session Creation: Ready (not connecting) ──────────────

	it("should return ready (not connecting) while session is being created", () => {
		const result = derivePanelViewState(
			makeInput({ lifecyclePresentation: null, hasSession: false })
		);
		expect(result.kind).toBe("ready");
	});

	it("should return conversation when entries exist even while session is being created", () => {
		const result = derivePanelViewState(
			makeInput({
				lifecyclePresentation: makeLifecyclePresentation(),
				entriesCount: 2,
			})
		);
		expect(result.kind).toBe("conversation");
	});

	it("should show ready when reconnecting — input stays available for message queue", () => {
		const result = derivePanelViewState(
			makeInput({
				lifecyclePresentation: makeLifecyclePresentation(),
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

	it("should keep showing conversation rows while restored content reloads", () => {
		const result = derivePanelViewState(
			makeInput({
				entriesCount: 5,
				hasSession: true,
				lifecyclePresentation: makeLifecyclePresentation({
					contentPhase: "loading",
					showConversation: false,
					showReadyPlaceholder: false,
				}),
			})
		);

		expect(result.kind).toBe("conversation");
	});

	it("should show the optimistic conversation while a new session is connecting", () => {
		const result = derivePanelViewState(
			makeInput({
				entriesCount: 1,
				hasSession: true,
				hasImmediatePendingSendIntent: true,
				lifecyclePresentation: makeLifecyclePresentation({
					connectionPhase: "connecting",
					contentPhase: "loading",
					showConversation: false,
					showReadyPlaceholder: false,
				}),
			})
		);

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
				lifecyclePresentation: makeLifecyclePresentation(),
				entriesCount: 3,
			})
		);
		expect(result.kind).toBe("conversation");
	});

	it("should show conversation when entries arrive before lifecycle presentation updates", () => {
		const result = derivePanelViewState(
			makeInput({
				lifecyclePresentation: makeLifecyclePresentation({
					showConversation: false,
					showReadyPlaceholder: true,
				}),
				entriesCount: 2,
			})
		);
		expect(result.kind).toBe("conversation");
	});

	it("should show conversation for an awaiting-model session with no entries", () => {
		const result = derivePanelViewState(
			makeInput({
				entriesCount: 0,
				hasSession: true,
				isAwaitingModelResponse: true,
			})
		);

		expect(result.kind).toBe("conversation");
	});

	it("should return ready while restored session content is materializing with no rows yet", () => {
		const result = derivePanelViewState(
			makeInput({
				entriesCount: 0,
				hasSession: true,
				lifecyclePresentation: makeLifecyclePresentation({
					contentPhase: "loading",
					showConversation: false,
					showReadyPlaceholder: false,
				}),
			})
		);

		expect(result.kind).toBe("ready");
	});

	// ── Bug fix regression: entries > 0 NEVER produces ready ───

	it("should never produce ready or project_selection when entries exist (bug fix)", () => {
		const configs = [
			makeInput({ entriesCount: 1 }),
			makeInput({ entriesCount: 1, lifecyclePresentation: null, hasSession: false }),
			makeInput({
				entriesCount: 1,
				lifecyclePresentation: makeLifecyclePresentation({ showReadyPlaceholder: true }),
			}),
			makeInput({
				entriesCount: 10,
				lifecyclePresentation: makeLifecyclePresentation({ showConversation: true }),
			}),
		];

		for (const input of configs) {
			const result = derivePanelViewState(input);
			expect(result.kind).not.toBe("ready");
			expect(result.kind).not.toBe("project_selection");
		}
	});

	// ── Priority 4: Ready ──────────────────────────────────────

	it("should return ready for new session with zero entries", () => {
		const result = derivePanelViewState(
			makeInput({
				lifecyclePresentation: makeLifecyclePresentation({
					showConversation: true,
					showReadyPlaceholder: false,
				}),
				entriesCount: 0,
			})
		);
		expect(result.kind).toBe("ready");
	});

	it("should return ready when no session but has project and agent", () => {
		const result = derivePanelViewState(
			makeInput({ lifecyclePresentation: null, hasSession: false })
		);
		expect(result.kind).toBe("ready");
	});

	it("should return ready when lifecycle presentation says ready and no entries", () => {
		const result = derivePanelViewState(
			makeInput({
				lifecyclePresentation: makeLifecyclePresentation({
					showConversation: false,
					showReadyPlaceholder: true,
				}),
				entriesCount: 0,
			})
		);
		expect(result.kind).toBe("ready");
	});
});
