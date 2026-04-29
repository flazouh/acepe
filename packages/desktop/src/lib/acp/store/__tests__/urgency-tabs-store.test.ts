import { describe, expect, it } from "vitest";

import type { SessionGraphActivity, SessionGraphLifecycle } from "$lib/services/acp-types.js";
import { InteractionStore } from "../interaction-store.svelte.js";
import { OperationStore } from "../operation-store.svelte.js";
import type { PanelStore } from "../panel-store.svelte.js";
import { SessionStore } from "../session-store.svelte.js";
import type { Panel, SessionTransientProjection } from "../types.js";
import { UrgencyTabsStore } from "../urgency-tabs-store.svelte.js";

const STATUS_CHANGED_AT = 1_777_400_000_000;

function createPanel(): Panel {
	return {
		id: "panel-1",
		kind: "agent",
		ownerPanelId: null,
		sessionId: "session-1",
		width: 400,
		pendingProjectSelection: false,
		selectedAgentId: "codex",
		projectPath: "/repo",
		agentId: "codex",
		sessionTitle: "Session",
	};
}

function createHotState(
	overrides: Partial<SessionTransientProjection> = {}
): SessionTransientProjection {
	const base: SessionTransientProjection = {
		acpSessionId: null,
		autonomousTransition: "idle",
		modelPerMode: {},
		statusChangedAt: STATUS_CHANGED_AT,
		pendingSendIntent: null,
		capabilityMutationState: {
			pendingMutationId: null,
			previewState: null,
		},
	};
	return Object.assign(base, overrides);
}

function createIdleActivity(): SessionGraphActivity {
	return {
		kind: "idle",
		activeOperationCount: 0,
		activeSubagentCount: 0,
		dominantOperationId: null,
		blockingInteractionId: null,
	};
}

function createLifecycle(status: SessionGraphLifecycle["status"]): SessionGraphLifecycle {
	return {
		status,
		detachedReason: null,
		failureReason: status === "failed" ? "resumeFailed" : null,
		errorMessage: status === "failed" ? "Connection dropped" : null,
		actionability: {
			canSend: status === "ready",
			canResume: status === "detached",
			canRetry: status === "failed",
			canArchive: status !== "archived",
			canConfigure: status === "ready",
			recommendedAction:
				status === "ready"
					? "send"
					: status === "failed"
						? "retry"
						: status === "detached"
							? "resume"
							: status === "archived"
								? "none"
								: "wait",
			recoveryPhase:
				status === "activating"
					? "activating"
					: status === "reconnecting"
						? "reconnecting"
						: status === "detached"
							? "detached"
							: status === "failed"
								? "failed"
								: status === "archived"
									? "archived"
									: "none",
			compactStatus: status,
		},
	};
}

function createPanelStore(): PanelStore {
	return {
		panels: [createPanel()],
		focusedPanelId: null,
	} as PanelStore;
}

function createSessionStore(input: {
	readonly hotState: SessionTransientProjection;
	readonly lifecycle: SessionGraphLifecycle | null;
}): SessionStore {
	const sessionStore = new SessionStore();
	const operationStore = new OperationStore();
	const activity = createIdleActivity();
	sessionStore.addSession({
		id: "session-1",
		projectPath: "/repo",
		agentId: "codex",
		title: "Session",
		updatedAt: new Date("2026-04-28T00:00:00.000Z"),
		createdAt: new Date("2026-04-28T00:00:00.000Z"),
		sessionLifecycleState: "persisted",
		parentId: null,
	});
	sessionStore.getSessionIdentity = () => ({
			id: "session-1",
			projectPath: "/repo",
			agentId: "codex",
			worktreePath: undefined,
		});
	sessionStore.getSessionMetadata = () => ({
			title: "Session",
			updatedAt: new Date("2026-04-28T00:00:00.000Z"),
			createdAt: new Date("2026-04-28T00:00:00.000Z"),
			sourcePath: undefined,
			sessionLifecycleState: "persisted",
			parentId: null,
		});
	sessionStore.getHotState = () => input.hotState;
	sessionStore.getOperationStore = () => operationStore;
	sessionStore.getSessionRuntimeState = () => null;
	sessionStore.getCanonicalSessionProjection = () =>
			input.lifecycle === null
				? null
				: {
						lifecycle: input.lifecycle,
						activity,
						turnState: input.lifecycle.status === "failed" ? "Failed" : "Idle",
						activeTurnFailure: null,
						lastTerminalTurnId: null,
						capabilities: {
							models: null,
							modes: null,
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
	sessionStore.getSessionLifecycleStatus = () => input.lifecycle?.status ?? null;
	sessionStore.getSessionConnectionError = () => input.lifecycle?.errorMessage ?? null;
	sessionStore.getSessionActiveTurnFailure = () => null;
	return sessionStore;
}

function createTabs(input: {
	readonly hotState: SessionTransientProjection;
	readonly lifecycle: SessionGraphLifecycle | null;
}) {
	const store = new UrgencyTabsStore(
		createPanelStore(),
		createSessionStore(input),
		new InteractionStore()
	);
	return store.tabs;
}

describe("UrgencyTabsStore canonical authority", () => {
	it("does not surface stale hot-state failures before a canonical projection exists", () => {
		const tabs = createTabs({
			hotState: createHotState(),
			lifecycle: null,
		});

		expect(tabs[0]).toMatchObject({
			hasError: false,
			isConnecting: false,
			urgency: {
				detail: null,
			},
		});
		expect(tabs[0]?.urgency.level).not.toBe("high");
	});

	it("surfaces failure from the first canonical failed envelope", () => {
		const tabs = createTabs({
			hotState: createHotState(),
			lifecycle: createLifecycle("failed"),
		});

		expect(tabs[0]).toMatchObject({
			hasError: true,
			isConnecting: false,
			urgency: {
				level: "high",
				detail: "Connection dropped",
			},
		});
	});

	it("uses canonical lifecycle for connecting state", () => {
		const tabs = createTabs({
			hotState: createHotState(),
			lifecycle: createLifecycle("reconnecting"),
		});

		expect(tabs[0]).toMatchObject({
			isConnecting: true,
			hasError: false,
		});
	});
});
