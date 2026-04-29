import { describe, expect, it } from "bun:test";

import type {
	LifecycleStatus,
	SessionGraphActivityKind,
} from "../../../services/acp-types.js";
import type { SessionEntry } from "../../application/dto/session-entry.js";
import type { CanonicalSessionProjection } from "../canonical-session-projection.js";
import { type PanelToTabInput, panelToTab } from "../tab-bar-utils.js";
import type { Panel, SessionTransientProjection } from "../types.js";

function makePanel(overrides: Partial<Panel> = {}): Panel {
	return {
		id: "panel-1",
		kind: "agent",
		ownerPanelId: null,
		sessionId: "session-1",
		width: 400,
		pendingProjectSelection: false,
		selectedAgentId: null,
		projectPath: null,
		agentId: null,
		sessionTitle: null,
		...overrides,
	};
}

function makeHotState(
	overrides: Partial<SessionTransientProjection> = {}
): SessionTransientProjection {
	return {
		acpSessionId: null,
		autonomousTransition: "idle",
		statusChangedAt: Date.now(),
		...overrides,
	};
}

function makeCanonicalProjection(
	status: LifecycleStatus = "ready",
	activityKind: SessionGraphActivityKind = "idle",
	currentModeId: string | null = null
): CanonicalSessionProjection {
	return {
		lifecycle: {
			status,
			errorMessage: null,
			detachedReason: null,
			failureReason: null,
			actionability: {
				canSend: status === "ready",
				canResume: status === "detached",
				canRetry: status === "failed",
				canArchive: true,
				canConfigure: status === "ready",
				recommendedAction: status === "ready" ? "send" : "wait",
				recoveryPhase: "none",
				compactStatus: status,
			},
		},
		activity: {
			kind: activityKind,
			activeOperationCount: activityKind === "running_operation" ? 1 : 0,
			activeSubagentCount: 0,
			dominantOperationId: activityKind === "running_operation" ? "op-1" : null,
			blockingInteractionId: null,
		},
		turnState: activityKind === "idle" ? "Idle" : "Running",
		activeTurnFailure: null,
		lastTerminalTurnId: null,
		capabilities: {
			models: null,
			modes: currentModeId === null ? null : { currentModeId, availableModes: [] },
			availableCommands: [],
			configOptions: [],
			autonomousEnabled: false,
		},
		revision: {
			graphRevision: 1,
			transcriptRevision: 1,
			lastEventSeq: 1,
		},
	};
}

function makeInput(overrides: Partial<PanelToTabInput> = {}): PanelToTabInput {
	const pendingPlanApproval = overrides.pendingPlanApproval ?? null;
	return {
		panel: makePanel(),
		focusedPanelId: null,
		agentId: "agent-1",
		title: "Test Session",
		hotState: makeHotState(),
		runtimeState: null,
		entries: [],
		currentStreamingToolCall: null,
		currentToolKind: null,
		pendingQuestion: null,
		pendingPermission: null,
		isUnseen: false,
		projectName: null,
		projectColor: null,
		projectIconSrc: null,
		projectPath: null,
		...overrides,
		pendingPlanApproval,
	};
}

describe("panelToTab", () => {
	describe("basic fields", () => {
		it("should set panelId from panel", () => {
			const tab = panelToTab(makeInput({ panel: makePanel({ id: "p-42" }) }));
			expect(tab.panelId).toBe("p-42");
		});

		it("should set sessionId from panel", () => {
			const tab = panelToTab(makeInput({ panel: makePanel({ sessionId: "s-99" }) }));
			expect(tab.sessionId).toBe("s-99");
		});

		it("should set agentId from input", () => {
			const tab = panelToTab(makeInput({ agentId: "agent-x" }));
			expect(tab.agentId).toBe("agent-x");
		});

		it("should set title from input", () => {
			const tab = panelToTab(makeInput({ title: "My Title" }));
			expect(tab.title).toBe("My Title");
		});

		it("should handle null title", () => {
			const tab = panelToTab(makeInput({ title: null }));
			expect(tab.title).toBeNull();
		});

		it("should handle null agentId", () => {
			const tab = panelToTab(makeInput({ agentId: null }));
			expect(tab.agentId).toBeNull();
		});
	});

	describe("isFocused", () => {
		it("should be true when focusedPanelId matches panel id", () => {
			const tab = panelToTab(
				makeInput({
					panel: makePanel({ id: "p-1" }),
					focusedPanelId: "p-1",
				})
			);
			expect(tab.isFocused).toBe(true);
		});

		it("should be false when focusedPanelId does not match", () => {
			const tab = panelToTab(
				makeInput({
					panel: makePanel({ id: "p-1" }),
					focusedPanelId: "p-2",
				})
			);
			expect(tab.isFocused).toBe(false);
		});

		it("should be false when focusedPanelId is null", () => {
			const tab = panelToTab(makeInput({ focusedPanelId: null }));
			expect(tab.isFocused).toBe(false);
		});
	});

	describe("currentModeId", () => {
		it("should return mode id when mode is set", () => {
			const tab = panelToTab(
				makeInput({
					canonicalProjection: makeCanonicalProjection("ready", "idle", "plan"),
				})
			);
			expect(tab.currentModeId).toBe("plan");
		});

		it("should return null when mode is null", () => {
			const tab = panelToTab(
				makeInput({
					canonicalProjection: makeCanonicalProjection("ready", "idle", null),
				})
			);
			expect(tab.currentModeId).toBeNull();
		});

		it("should return null when hotState is null", () => {
			const tab = panelToTab(makeInput({ hotState: null }));
			expect(tab.currentModeId).toBeNull();
		});
	});

	describe("state.activity streaming", () => {
		it("should be thinking when canonical activity is awaiting_model", () => {
			const tab = panelToTab(
				makeInput({
					canonicalProjection: makeCanonicalProjection("ready", "awaiting_model"),
				})
			);
			expect(tab.state.activity.kind).toBe("thinking");
		});

		it("should be thinking when graph-backed activity is awaiting_model", () => {
			const tab = panelToTab(
				makeInput({
					canonicalProjection: makeCanonicalProjection("ready", "awaiting_model"),
					runtimeState: {
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
					},
				})
			);

			expect(tab.state.activity.kind).toBe("thinking");
		});

		it("should be streaming when graph-backed activity is running_operation", () => {
			const tab = panelToTab(
				makeInput({
					canonicalProjection: makeCanonicalProjection("ready", "running_operation"),
					runtimeState: {
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
					},
				})
			);

			expect(tab.state.activity.kind).toBe("streaming");
		});

		it("should be idle when status is idle", () => {
			const tab = panelToTab(
				makeInput({
					canonicalProjection: null,
				})
			);
			expect(tab.state.activity.kind).toBe("idle");
		});

		it("should be idle when hotState is null", () => {
			const tab = panelToTab(makeInput({ hotState: null }));
			expect(tab.state.activity.kind).toBe("idle");
		});
	});

	describe("state.connection connecting", () => {
		it("should be connecting when canonical lifecycle is activating", () => {
			const tab = panelToTab(
				makeInput({
					canonicalProjection: makeCanonicalProjection("activating", "idle"),
				})
			);
			expect(tab.state.connection).toBe("connecting");
		});

		it("should be connecting when canonical lifecycle is reconnecting", () => {
			const tab = panelToTab(
				makeInput({
					canonicalProjection: makeCanonicalProjection("reconnecting", "idle"),
				})
			);
			expect(tab.state.connection).toBe("connecting");
		});

		it("should be disconnected when status is idle", () => {
			const tab = panelToTab(makeInput({ canonicalProjection: null }));
			expect(tab.state.connection).toBe("disconnected");
		});
	});

	describe("state.connection error", () => {
		it("should be error when canonical lifecycle is failed", () => {
			const tab = panelToTab(
				makeInput({
					canonicalProjection: makeCanonicalProjection("failed", "idle"),
				})
			);
			expect(tab.state.connection).toBe("error");
		});

		it("should be connected when canonical lifecycle is ready", () => {
			const tab = panelToTab(
				makeInput({
					canonicalProjection: makeCanonicalProjection("ready", "awaiting_model"),
				})
			);
			expect(tab.state.connection).toBe("connected");
		});
	});

	describe("state.pendingInput question", () => {
		it("should be question when pendingQuestion is set", () => {
			const mockQuestion = {
				id: "q-1",
				sessionId: "s-1",
				questions: [],
			} as Parameters<typeof panelToTab>[0]["pendingQuestion"];
			const tab = panelToTab(makeInput({ pendingQuestion: mockQuestion }));
			expect(tab.state.pendingInput.kind).toBe("question");
		});

		it("should be none when pendingQuestion is null", () => {
			const tab = panelToTab(makeInput({ pendingQuestion: null }));
			expect(tab.state.pendingInput.kind).toBe("none");
		});
	});

	describe("isUnseen", () => {
		it("should pass through isUnseen flag", () => {
			const tab = panelToTab(makeInput({ isUnseen: true }));
			expect(tab.isUnseen).toBe(true);
		});

		it("should default to false", () => {
			const tab = panelToTab(makeInput({ isUnseen: false }));
			expect(tab.isUnseen).toBe(false);
		});
	});

	describe("currentToolKind", () => {
		it("should return null when entries are empty", () => {
			const tab = panelToTab(makeInput({ entries: [] }));
			expect(tab.currentToolKind).toBeNull();
		});

		it("should return tool kind from streaming tool call", () => {
			const entries: SessionEntry[] = [
				{
					id: "e-1",
					type: "tool_call",
					isStreaming: true,
					message: {
						id: "tc-1",
						name: "tool",
						kind: "edit",
						arguments: { kind: "other" },
						status: "running",
					},
				} as unknown as SessionEntry,
			];
			const tab = panelToTab(
				makeInput({
					entries,
					currentStreamingToolCall: entries[0]?.type === "tool_call" ? entries[0].message : null,
					currentToolKind: "edit",
				})
			);
			expect(tab.currentToolKind).toBe("edit");
		});

		it("should return null when no tool call is streaming", () => {
			const entries: SessionEntry[] = [
				{
					id: "e-1",
					type: "tool_call",
					isStreaming: false,
					message: {
						id: "tc-1",
						name: "tool",
						kind: "edit",
						arguments: { kind: "other" },
						status: "complete",
					},
				} as unknown as SessionEntry,
			];
			const tab = panelToTab(makeInput({ entries }));
			expect(tab.currentToolKind).toBeNull();
		});
	});

	describe("status defaults", () => {
		it("should default to disconnected idle state when hotState is null", () => {
			const tab = panelToTab(makeInput({ hotState: null }));
			expect(tab.state.activity.kind).toBe("idle");
			expect(tab.state.connection).toBe("disconnected");
		});
	});

	describe("project badge fields", () => {
		it("should pass through projectName and projectColor when provided", () => {
			const tab = panelToTab(
				makeInput({
					projectName: "acepe",
					projectColor: "#16DB95",
				})
			);
			expect(tab.projectName).toBe("acepe");
			expect(tab.projectColor).toBe("#16DB95");
		});

		it("should allow null projectName and projectColor", () => {
			const tab = panelToTab(makeInput({ projectName: null, projectColor: null }));
			expect(tab.projectName).toBeNull();
			expect(tab.projectColor).toBeNull();
		});
	});
});
