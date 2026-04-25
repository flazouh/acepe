import { describe, expect, it } from "bun:test";

import {
	type NonAgentPanelToTabInput,
	nonAgentPanelToTab,
	type PanelToTabInput,
	panelToTab,
} from "../tab-bar-utils.js";
import type {
	BrowserWorkspacePanel,
	FileWorkspacePanel,
	Panel,
	SessionTransientProjection,
	TerminalWorkspacePanel,
} from "../types.js";

// =============================================================================
// panelToTab test helpers
// =============================================================================

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

function makeHotState(overrides: Partial<SessionTransientProjection> = {}): SessionTransientProjection {
	return {
		status: "idle",
		isConnected: true,
		turnState: "idle",
		acpSessionId: null,
		connectionError: null,
		autonomousEnabled: false,
		autonomousTransition: "idle",
		currentModel: null,
		currentMode: null,
		availableCommands: [],
		statusChangedAt: Date.now(),
		...overrides,
	};
}

function makeInput(overrides: Partial<PanelToTabInput> = {}): PanelToTabInput {
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
		pendingPlanApproval: null,
		pendingPermission: null,
		isUnseen: false,
		projectName: null,
		projectColor: null,
		projectIconSrc: null,
		projectPath: null,
		...overrides,
	};
}

// =============================================================================
// panelToTab tests
// =============================================================================

describe("panelToTab", () => {
	describe("happy path — basic field mapping", () => {
		it("passes panelId, sessionId and agentId through", () => {
			const tab = panelToTab(
				makeInput({ panel: makePanel({ id: "p-7", sessionId: "s-7" }), agentId: "cursor" })
			);
			expect(tab.panelId).toBe("p-7");
			expect(tab.sessionId).toBe("s-7");
			expect(tab.agentId).toBe("cursor");
		});

		it("passes title through", () => {
			const tab = panelToTab(makeInput({ title: "My title" }));
			expect(tab.title).toBe("My title");
		});

		it("reflects isFocused when panel id matches focusedPanelId", () => {
			const tab = panelToTab(makeInput({ panel: makePanel({ id: "p-1" }), focusedPanelId: "p-1" }));
			expect(tab.isFocused).toBe(true);
		});

		it("reflects isFocused false when panel id does not match", () => {
			const tab = panelToTab(makeInput({ panel: makePanel({ id: "p-1" }), focusedPanelId: "p-2" }));
			expect(tab.isFocused).toBe(false);
		});

		it("extracts currentModeId from hotState", () => {
			const tab = panelToTab(
				makeInput({ hotState: makeHotState({ currentMode: { id: "plan", name: "Plan" } }) })
			);
			expect(tab.currentModeId).toBe("plan");
		});
	});

	describe("null / undefined session handling", () => {
		it("returns null title when title is null", () => {
			const tab = panelToTab(makeInput({ title: null }));
			expect(tab.title).toBeNull();
		});

		it("returns null agentId when agentId is null", () => {
			const tab = panelToTab(makeInput({ agentId: null }));
			expect(tab.agentId).toBeNull();
		});

		it("returns null sessionId when panel has no sessionId", () => {
			const tab = panelToTab(makeInput({ panel: makePanel({ sessionId: null }) }));
			expect(tab.sessionId).toBeNull();
		});

		it("returns null currentModeId when hotState is null", () => {
			const tab = panelToTab(makeInput({ hotState: null }));
			expect(tab.currentModeId).toBeNull();
		});

		it("produces disconnected idle state when hotState is null", () => {
			const tab = panelToTab(makeInput({ hotState: null }));
			expect(tab.state.connection).toBe("disconnected");
			expect(tab.state.activity.kind).toBe("idle");
		});
	});

	describe("state derivation — various panel states", () => {
		it("derives connected thinking state from status=streaming when runtime facts are unavailable", () => {
			const tab = panelToTab(makeInput({ hotState: makeHotState({ status: "streaming" }) }));
			expect(tab.state.connection).toBe("connected");
			expect(tab.state.activity.kind).toBe("thinking");
		});

		it("derives connecting state from status=connecting", () => {
			const tab = panelToTab(makeInput({ hotState: makeHotState({ status: "connecting" }) }));
			expect(tab.state.connection).toBe("connecting");
		});

		it("prefers graph-backed running activity over missing live tool-call truthiness", () => {
			const tab = panelToTab(
				makeInput({
					hotState: makeHotState({
						status: "ready",
						currentMode: { id: "build", name: "Build" },
						activity: {
							kind: "running_operation",
							activeOperationCount: 2,
							activeSubagentCount: 1,
							dominantOperationId: "op-2",
							blockingInteractionId: null,
						},
					}),
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
					currentStreamingToolCall: null,
				})
			);

			expect(tab.workBucket).toBe("working");
			expect(tab.state.activity.kind).toBe("streaming");
		});

		it("derives connecting state from status=loading", () => {
			const tab = panelToTab(makeInput({ hotState: makeHotState({ status: "loading" }) }));
			expect(tab.state.connection).toBe("connecting");
		});

		it("derives error state from status=error", () => {
			const tab = panelToTab(makeInput({ hotState: makeHotState({ status: "error" }) }));
			expect(tab.state.connection).toBe("error");
		});

		it("classifies connectionError-only sessions as error work buckets", () => {
			const tab = panelToTab(
				makeInput({
					hotState: makeHotState({ status: "ready", connectionError: "Resume failed" }),
				})
			);
			expect(tab.state.connection).toBe("error");
			expect(tab.workBucket).toBe("error");
		});

		it("classifies activeTurnFailure-only sessions as error work buckets", () => {
			const tab = panelToTab(
				makeInput({
					hotState: makeHotState({
						status: "ready",
						activeTurnFailure: {
							turnId: "turn-1",
							message: "Usage limit reached",
							code: "429",
							kind: "recoverable",
							source: "process",
						},
					}),
				})
			);
			expect(tab.state.connection).toBe("error");
			expect(tab.workBucket).toBe("error");
		});

		it("derives disconnected state from status=idle (no session)", () => {
			const tab = panelToTab(makeInput({ hotState: makeHotState({ status: "idle" }) }));
			expect(tab.state.connection).toBe("disconnected");
		});

		it("derives pending question from pendingQuestion input", () => {
			const question = { id: "q-1", sessionId: "s-1", questions: [] } as Parameters<
				typeof panelToTab
			>[0]["pendingQuestion"];
			const tab = panelToTab(makeInput({ pendingQuestion: question }));
			expect(tab.state.pendingInput.kind).toBe("question");
		});

		it("derives no pending input when pendingQuestion is null", () => {
			const tab = panelToTab(makeInput({ pendingQuestion: null }));
			expect(tab.state.pendingInput.kind).toBe("none");
		});

		it("derives pending permission from pendingPermission input", () => {
			const permission = {
				id: "p-1",
				sessionId: "s-1",
				permission: "write",
				patterns: [],
				metadata: {},
				always: [],
			} as Parameters<typeof panelToTab>[0]["pendingPermission"];
			const tab = panelToTab(makeInput({ pendingPermission: permission }));
			expect(tab.state.pendingInput.kind).toBe("permission");
		});

		it("derives pending plan approval from pendingPlanApproval input", () => {
			const planApproval = {
				id: "plan-1",
				kind: "plan_approval" as const,
				source: "create_plan" as const,
				sessionId: "s-1",
				tool: { messageID: "", callID: "tool-1" },
				jsonRpcRequestId: 7,
				replyHandler: { kind: "json-rpc" as const, requestId: 7 },
				status: "pending" as const,
			};
			const tab = panelToTab(makeInput({ pendingPlanApproval: planApproval }));
			expect(tab.state.pendingInput.kind).toBe("plan_approval");
		});

		it("question takes priority over permission in pendingInput", () => {
			const question = { id: "q-1", sessionId: "s-1", questions: [] } as Parameters<
				typeof panelToTab
			>[0]["pendingQuestion"];
			const permission = {
				id: "p-1",
				sessionId: "s-1",
				permission: "write",
				patterns: [],
				metadata: {},
				always: [],
			} as Parameters<typeof panelToTab>[0]["pendingPermission"];
			const tab = panelToTab(
				makeInput({ pendingQuestion: question, pendingPermission: permission })
			);
			expect(tab.state.pendingInput.kind).toBe("question");
		});

		it("derives unseen completion in attention meta", () => {
			const tab = panelToTab(makeInput({ isUnseen: true }));
			expect(tab.state.attention.hasUnseenCompletion).toBe(true);
		});

		it("derives paused state from status=paused", () => {
			const tab = panelToTab(makeInput({ hotState: makeHotState({ status: "paused" }) }));
			expect(tab.state.activity.kind).toBe("paused");
		});

		it("classifies runtime thinking as active work", () => {
			const tab = panelToTab(
				makeInput({
					runtimeState: {
						connectionPhase: "connected",
						contentPhase: "loaded",
						activityPhase: "running",
						canSubmit: false,
						canCancel: true,
						showStop: true,
						showThinking: true,
						showConnectingOverlay: false,
						showConversation: true,
						showReadyPlaceholder: false,
					},
					hotState: makeHotState({ status: "ready" }),
				})
			);
			expect(tab.state.activity.kind).toBe("thinking");
			expect(tab.workBucket).toBe("working");
		});
	});

	describe("project badge fields", () => {
		it("passes projectName and projectColor through", () => {
			const tab = panelToTab(
				makeInput({ projectName: "acepe", projectColor: "#16DB95", projectPath: "/projects/acepe" })
			);
			expect(tab.projectName).toBe("acepe");
			expect(tab.projectColor).toBe("#16DB95");
			expect(tab.projectPath).toBe("/projects/acepe");
		});

		it("allows null projectName, projectColor and projectPath", () => {
			const tab = panelToTab(
				makeInput({ projectName: null, projectColor: null, projectPath: null })
			);
			expect(tab.projectName).toBeNull();
			expect(tab.projectColor).toBeNull();
			expect(tab.projectPath).toBeNull();
		});
	});
});

function makeFilePanel(overrides: Partial<FileWorkspacePanel> = {}): FileWorkspacePanel {
	return {
		id: "file-1",
		kind: "file",
		projectPath: "/projects/acepe",
		ownerPanelId: null,
		width: 400,
		filePath: "src/lib/main.ts",
		...overrides,
	};
}

function makeTerminalPanel(
	overrides: Partial<TerminalWorkspacePanel> = {}
): TerminalWorkspacePanel {
	return {
		id: "terminal-1",
		kind: "terminal",
		projectPath: "/projects/acepe",
		ownerPanelId: null,
		width: 400,
		groupId: "group-1",
		...overrides,
	};
}

function makeBrowserPanel(overrides: Partial<BrowserWorkspacePanel> = {}): BrowserWorkspacePanel {
	return {
		id: "browser-1",
		kind: "browser",
		projectPath: "/projects/acepe",
		ownerPanelId: null,
		width: 400,
		url: "https://example.com",
		title: "Example",
		...overrides,
	};
}

function makeNonAgentInput(
	overrides: Partial<NonAgentPanelToTabInput> = {}
): NonAgentPanelToTabInput {
	return {
		panel: makeFilePanel(),
		focusedPanelId: null,
		projectName: "acepe",
		projectColor: "#16DB95",
		projectIconSrc: null,
		...overrides,
	};
}

describe("nonAgentPanelToTab", () => {
	it("derives a file tab title from the file path", () => {
		const tab = nonAgentPanelToTab(makeNonAgentInput({ panel: makeFilePanel() }));

		expect(tab.title).toBe("main.ts");
		expect(tab.projectPath).toBe("/projects/acepe");
		expect(tab.agentId).toBeNull();
		expect(tab.sessionId).toBeNull();
	});

	it("uses a fixed title for terminal tabs", () => {
		const tab = nonAgentPanelToTab(makeNonAgentInput({ panel: makeTerminalPanel() }));

		expect(tab.title).toBe("Terminal");
		expect(tab.state.connection).toBe("disconnected");
		expect(tab.state.activity.kind).toBe("idle");
	});

	it("uses the browser panel title for browser tabs", () => {
		const tab = nonAgentPanelToTab(
			makeNonAgentInput({ panel: makeBrowserPanel({ title: "Docs" }), focusedPanelId: "browser-1" })
		);

		expect(tab.title).toBe("Docs");
		expect(tab.isFocused).toBe(true);
		expect(tab.projectName).toBe("acepe");
		expect(tab.projectColor).toBe("#16DB95");
	});
});
