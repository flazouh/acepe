import { describe, expect, it } from "bun:test";

import {
	canSendWithoutSession,
	EMPTY_STATE_PANEL_ID,
	resolveEmptyStateAgentId,
	resolveEmptyStateWorktreePending,
	resolveEmptyStateWorktreePendingForProjectChange,
	shouldClearPersistedDraftBeforeAsyncSend,
	shouldRestoreInitialDraft,
	shouldShowOptimisticConnecting,
} from "../empty-state-send-state.js";

describe("empty-state send state", () => {
	it("treats global default worktree as pending before first send", () => {
		expect(
			resolveEmptyStateWorktreePending({
				activeWorktreePath: null,
				globalWorktreeDefault: true,
				loadEnabled: (_panelId, globalDefault) => globalDefault,
			})
		).toBe(true);
	});

	it("uses the empty-state panel id when loading persisted worktree state", () => {
		let receivedPanelId: string | null = null;

		resolveEmptyStateWorktreePending({
			activeWorktreePath: null,
			globalWorktreeDefault: false,
			loadEnabled: (panelId) => {
				receivedPanelId = panelId;
				return true;
			},
		});

		expect(receivedPanelId === EMPTY_STATE_PANEL_ID).toBe(true);
	});

	it("respects a persisted opt-out even when global default is enabled", () => {
		expect(
			resolveEmptyStateWorktreePending({
				activeWorktreePath: null,
				globalWorktreeDefault: true,
				loadEnabled: () => false,
			})
		).toBe(false);
	});

	it("stops pending once a worktree path exists", () => {
		expect(
			resolveEmptyStateWorktreePending({
				activeWorktreePath: "/tmp/worktree",
				globalWorktreeDefault: true,
				loadEnabled: () => true,
			})
		).toBe(false);
	});

	it("re-resolves pending worktree state when the selected project changes", () => {
		expect(
			resolveEmptyStateWorktreePendingForProjectChange({
				globalWorktreeDefault: false,
				loadEnabled: (panelId) => panelId === EMPTY_STATE_PANEL_ID,
			})
		).toBe(true);
	});

	it("shows optimistic connecting state while first send is pending without a session", () => {
		expect(
			shouldShowOptimisticConnecting({
				hasSession: false,
				hasPendingUserEntry: true,
			})
		).toBe(true);
	});

	it("clears persisted draft immediately for empty-state first send", () => {
		expect(
			shouldClearPersistedDraftBeforeAsyncSend({
				panelId: EMPTY_STATE_PANEL_ID,
				sessionId: null,
			})
		).toBe(true);
	});

	it("keeps persisted draft until send succeeds for existing sessions", () => {
		expect(
			shouldClearPersistedDraftBeforeAsyncSend({
				panelId: "panel-1",
				sessionId: "session-1",
			})
		).toBe(false);
	});

	it("does not restore a persisted draft when the panel now has a session", () => {
		expect(
			shouldRestoreInitialDraft({
				panelId: EMPTY_STATE_PANEL_ID,
				sessionId: "session-1",
				draft: "what is pwd here ?",
			})
		).toBe(false);
	});

	it("does not restore a persisted draft during first-send handoff", () => {
		expect(
			shouldRestoreInitialDraft({
				panelId: EMPTY_STATE_PANEL_ID,
				sessionId: null,
				draft: "what is pwd here ?",
				hasPendingUserEntry: true,
			})
		).toBe(false);
	});

	it("restores a persisted draft for empty panels without a session", () => {
		expect(
			shouldRestoreInitialDraft({
				panelId: EMPTY_STATE_PANEL_ID,
				sessionId: null,
				draft: "hello",
			})
		).toBe(true);
	});

	it("selects the first available agent by default in empty state", () => {
		expect(
			resolveEmptyStateAgentId({
				selectedAgentId: null,
				availableAgentIds: ["cursor", "claude-code"],
			})
		).toBe("cursor");
	});

	it("keeps the explicit empty-state agent when it is still available", () => {
		expect(
			resolveEmptyStateAgentId({
				selectedAgentId: "claude-code",
				availableAgentIds: ["cursor", "claude-code"],
			})
		).toBe("claude-code");
	});

	it("falls back to the first available agent when the selected one disappears", () => {
		expect(
			resolveEmptyStateAgentId({
				selectedAgentId: "claude-code",
				availableAgentIds: ["cursor"],
			})
		).toBe("cursor");
	});

	it("prefers default agent when no explicit selection exists", () => {
		expect(
			resolveEmptyStateAgentId({
				selectedAgentId: null,
				defaultAgentId: "opencode",
				availableAgentIds: ["cursor", "opencode", "claude-code"],
			})
		).toBe("opencode");
	});

	it("explicit selection wins over default agent", () => {
		expect(
			resolveEmptyStateAgentId({
				selectedAgentId: "cursor",
				defaultAgentId: "opencode",
				availableAgentIds: ["cursor", "opencode"],
			})
		).toBe("cursor");
	});

	it("falls back to first available when default agent is not in available list", () => {
		expect(
			resolveEmptyStateAgentId({
				selectedAgentId: null,
				defaultAgentId: "opencode",
				availableAgentIds: ["cursor", "claude-code"],
			})
		).toBe("cursor");
	});

	it("falls back to first available when default agent is null", () => {
		expect(
			resolveEmptyStateAgentId({
				selectedAgentId: null,
				defaultAgentId: null,
				availableAgentIds: ["cursor", "claude-code"],
			})
		).toBe("cursor");
	});

	it("blocks first send when no agent is selected", () => {
		expect(
			canSendWithoutSession({
				projectPath: "/repo",
				selectedAgentId: null,
			})
		).toBe(false);
	});

	it("blocks first send when no project is selected", () => {
		expect(
			canSendWithoutSession({
				projectPath: null,
				selectedAgentId: "claude-code",
			})
		).toBe(false);
	});

	it("allows first send when both project and agent are selected", () => {
		expect(
			canSendWithoutSession({
				projectPath: "/repo",
				selectedAgentId: "claude-code",
			})
		).toBe(true);
	});
});
