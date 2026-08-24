import { describe, expect, it, mock } from "bun:test";
import * as Effect from "effect/Effect";
import * as Result from "effect/Result";

import type { Session } from "../../../../../../acp/application/dto/session.js";
import { createSession } from "../../../../../../acp/components/agent-input/logic/session-manager.js";
import type { SessionStore } from "../../../../../../acp/store/session-store.svelte.js";
import {
	canSendWithoutSession,
	resolveEmptyStateAgentId,
	resolveEmptyStateWorktreePending,
	resolveEmptyStateWorktreePendingForProjectChange,
	shouldClearPersistedDraftBeforeAsyncSend,
	shouldRestoreInitialDraft,
	shouldShowOptimisticConnecting,
} from "../empty-state-send-state.js";

describe("empty-state send state", () => {
	it("treats per-project worktree default as pending before first send", () => {
		expect(
			resolveEmptyStateWorktreePending({
				activeWorktreePath: null,
				projectPath: "/repo",
				isProjectWorktreeEnabled: () => true,
			})
		).toBe(true);
	});

	it("returns false when no project path is selected", () => {
		expect(
			resolveEmptyStateWorktreePending({
				activeWorktreePath: null,
				projectPath: null,
				isProjectWorktreeEnabled: () => true,
			})
		).toBe(false);
	});

	it("respects per-project opt-out", () => {
		expect(
			resolveEmptyStateWorktreePending({
				activeWorktreePath: null,
				projectPath: "/repo",
				isProjectWorktreeEnabled: () => false,
			})
		).toBe(false);
	});

	it("stops pending once a worktree path exists", () => {
		expect(
			resolveEmptyStateWorktreePending({
				activeWorktreePath: "/tmp/worktree",
				projectPath: "/repo",
				isProjectWorktreeEnabled: () => true,
			})
		).toBe(false);
	});

	it("re-resolves pending worktree state when the selected project changes", () => {
		expect(
			resolveEmptyStateWorktreePendingForProjectChange({
				projectPath: "/repo-b",
				isProjectWorktreeEnabled: (path) => path === "/repo-b",
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
				panelId: "empty-state-panel",
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
				panelId: "empty-state-panel",
				sessionId: "session-1",
				draft: "what is pwd here ?",
			})
		).toBe(false);
	});

	it("does not restore a persisted draft during first-send handoff", () => {
		expect(
			shouldRestoreInitialDraft({
				panelId: "empty-state-panel",
				sessionId: null,
				draft: "what is pwd here ?",
				hasPendingUserEntry: true,
			})
		).toBe(false);
	});

	it("restores a persisted draft for empty panels without a session", () => {
		expect(
			shouldRestoreInitialDraft({
				panelId: "empty-state-panel",
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

// GAP2 regression: the New-chat composer's selected agent must reach
// session-manager.createSession's agentId, all the way from the live
// agent list (agentStore.agents, sourced from the agentCall RPC's
// agent.list op -- see acp/store/agent-store.svelte.ts's
// loadAvailableAgents). Before that RPC had a real backend, listAgents
// resolved to an empty array forever, so resolveEmptyStateAgentId had
// nothing to select and createSession never saw an agentId at all -- a
// panel could be spawned and sent with no agent (found live, in a
// QA-spawned panel). This closes the loop end to end at the store/
// controller seam: given the same shape agentStore.agents holds once
// listAgents succeeds, the resolved id is exactly what createSession
// dispatches with.
// Only `id` is read (sessionCreationHandle reads result.session.id) -- the
// rest of Session's fields are irrelevant to this seam, so the mock is cast
// rather than filled in field by field.
const fakeSession = { id: "session-1" } as unknown as Session;

describe("agent selection propagation from the live agent list to createSession (GAP2)", () => {
	it("reproduces the live bug: an empty agent list resolves no agent, and createSession never sees one", () => {
		// The exact shape agentStore.agents holds before listAgents ever
		// resolves (or when it was unsupportedOnContract, as it was before
		// GAP1): no agents to offer.
		const availableAgentIds: readonly string[] = [];
		const resolvedAgentId = resolveEmptyStateAgentId({
			selectedAgentId: null,
			defaultAgentId: null,
			availableAgentIds,
		});
		expect(resolvedAgentId).toBeNull();
		expect(canSendWithoutSession({ projectPath: "/repo", selectedAgentId: resolvedAgentId })).toBe(
			false
		);
	});

	it("propagates the live agent list's first agent through to createSession's agentId", () =>
		Effect.runPromise(
			Effect.gen(function* () {
				// The shape agentStore.agents holds once listAgents succeeds
				// (GAP1): at least the always-real claude-code adapter.
				const availableAgentIds = ["claude-code"];
				const resolvedAgentId = resolveEmptyStateAgentId({
					selectedAgentId: null,
					defaultAgentId: null,
					availableAgentIds,
				});
				expect(resolvedAgentId).toBe("claude-code");
				expect(
					canSendWithoutSession({ projectPath: "/repo", selectedAgentId: resolvedAgentId })
				).toBe(true);

				const createSessionMock = mock(() =>
					Effect.succeed({ kind: "ready" as const, session: fakeSession })
				);
				const mockStore = {
					connection: { createSession: createSessionMock },
				} as unknown as SessionStore;

				expect(resolvedAgentId).not.toBeNull();
				const result = yield* createSession(mockStore, {
					agentId: resolvedAgentId as string,
					projectPath: "/repo",
					projectName: "Repo",
				}).pipe(Effect.result);
				expect(Result.isSuccess(result)).toBe(true);
				expect(createSessionMock).toHaveBeenCalledWith(
					expect.objectContaining({ agentId: "claude-code", projectPath: "/repo" })
				);
			})
		));
});
