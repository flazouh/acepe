import { describe, expect, it } from "bun:test";

import type { SessionEntry } from "../../application/dto/session-entry.js";
import type { ToolKind } from "../../types/tool-kind.js";
import { getCurrentToolKind, type PanelToTabInput, panelToTab } from "../tab-bar-utils.js";
import type { Panel, SessionHotState } from "../types.js";

// =============================================================================
// panelToTab test helpers
// =============================================================================

function makePanel(overrides: Partial<Panel> = {}): Panel {
	return {
		id: "panel-1",
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

function makeHotState(overrides: Partial<SessionHotState> = {}): SessionHotState {
	return {
		status: "idle",
		isConnected: true,
		turnState: "idle",
		acpSessionId: null,
		connectionError: null,
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
		entries: [],
		pendingQuestion: null,
		pendingPermission: null,
		isUnseen: false,
		projectName: null,
		projectColor: null,
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
		it("derives connected streaming state from status=streaming", () => {
			const tab = panelToTab(makeInput({ hotState: makeHotState({ status: "streaming" }) }));
			expect(tab.state.connection).toBe("connected");
			expect(tab.state.activity.kind).toBe("streaming");
		});

		it("derives connecting state from status=connecting", () => {
			const tab = panelToTab(makeInput({ hotState: makeHotState({ status: "connecting" }) }));
			expect(tab.state.connection).toBe("connecting");
		});

		it("derives connecting state from status=loading", () => {
			const tab = panelToTab(makeInput({ hotState: makeHotState({ status: "loading" }) }));
			expect(tab.state.connection).toBe("connecting");
		});

		it("derives error state from status=error", () => {
			const tab = panelToTab(makeInput({ hotState: makeHotState({ status: "error" }) }));
			expect(tab.state.connection).toBe("error");
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

// =============================================================================
// getCurrentToolKind helpers
// =============================================================================

function makeToolCallEntry(kind: string | null | undefined, isStreaming: boolean): SessionEntry {
	return {
		id: `entry-${Math.random()}`,
		type: "tool_call",
		isStreaming,
		message: {
			id: "tc-1",
			name: "some_tool",
			kind: kind as ToolKind | null | undefined,
			arguments: { kind: "other" },
			status: "running",
		},
	} as unknown as SessionEntry;
}

function makeAssistantEntry(): SessionEntry {
	return {
		id: `entry-${Math.random()}`,
		type: "assistant",
		message: { content: "hello", chunks: [] },
	} as unknown as SessionEntry;
}

describe("getCurrentToolKind", () => {
	it("should return null for empty entries", () => {
		expect(getCurrentToolKind([])).toBeNull();
	});

	it("should return null when no tool calls are streaming", () => {
		const entries: SessionEntry[] = [makeToolCallEntry("edit", false), makeAssistantEntry()];
		expect(getCurrentToolKind(entries)).toBeNull();
	});

	it("should return the kind of the last streaming tool call", () => {
		const entries: SessionEntry[] = [
			makeToolCallEntry("edit", false),
			makeToolCallEntry("execute", true),
		];
		expect(getCurrentToolKind(entries)).toBe("execute");
	});

	it("should return the most recent streaming tool call when multiple are streaming", () => {
		const entries: SessionEntry[] = [
			makeToolCallEntry("edit", true),
			makeToolCallEntry("search", true),
		];
		expect(getCurrentToolKind(entries)).toBe("search");
	});

	it("should skip non-tool-call entries when searching", () => {
		const entries: SessionEntry[] = [
			makeToolCallEntry("edit", true),
			makeAssistantEntry(),
			makeToolCallEntry("execute", false),
		];
		// Last streaming is "edit" (execute is not streaming, assistant is skipped)
		expect(getCurrentToolKind(entries)).toBe("edit");
	});

	it("should fall back to 'other' when kind is null", () => {
		const entries: SessionEntry[] = [makeToolCallEntry(null, true)];
		expect(getCurrentToolKind(entries)).toBe("other");
	});

	it("should fall back to 'other' when kind is undefined", () => {
		const entries: SessionEntry[] = [makeToolCallEntry(undefined, true)];
		expect(getCurrentToolKind(entries)).toBe("other");
	});

	it("should return all known tool kinds correctly", () => {
		const kinds: ToolKind[] = [
			"read",
			"edit",
			"execute",
			"search",
			"fetch",
			"think",
			"todo",
			"question",
			"task",
			"skill",
			"move",
			"delete",
			"enter_plan_mode",
			"exit_plan_mode",
			"other",
		];
		for (const kind of kinds) {
			const entries: SessionEntry[] = [makeToolCallEntry(kind, true)];
			expect(getCurrentToolKind(entries)).toBe(kind);
		}
	});
});
