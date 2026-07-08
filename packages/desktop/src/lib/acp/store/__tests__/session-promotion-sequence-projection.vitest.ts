import { beforeEach, describe, expect, it, vi } from "vitest";

import type { SessionOpenFound } from "$lib/services/acp-types.js";

vi.mock("$lib/analytics.js", () => ({
	captureException: vi.fn(),
	initAnalytics: vi.fn(),
	setAnalyticsEnabled: vi.fn(),
}));

import { SessionStore } from "../session-store.svelte.js";

function createSessionOpenFound(overrides: Partial<SessionOpenFound> = {}): SessionOpenFound {
	return {
		requestedSessionId: overrides.requestedSessionId ?? "session-1",
		canonicalSessionId: overrides.canonicalSessionId ?? "session-1",
		isAlias: overrides.isAlias ?? false,
		openPath: overrides.openPath ?? "legacy_rebuild",
		lastEventSeq: overrides.lastEventSeq ?? 1,
		graphRevision: overrides.graphRevision ?? 1,
		openToken: overrides.openToken ?? "open-token",
		agentId: overrides.agentId ?? "claude-code",
		projectPath: overrides.projectPath ?? "/repo",
		worktreePath: overrides.worktreePath ?? null,
		sourcePath: overrides.sourcePath ?? "/repo/session.jsonl",
		sequenceId: overrides.sequenceId ?? 3,
		transcriptSnapshot: overrides.transcriptSnapshot ?? {
			revision: 1,
			entries: [],
		},
		sessionTitle: overrides.sessionTitle ?? "Promoted session",
		operations: overrides.operations ?? [],
		interactions: overrides.interactions ?? [],
		turnState: overrides.turnState ?? "Idle",
		messageCount: overrides.messageCount ?? 0,
		activity: overrides.activity ?? {
			kind: "idle",
			activeOperationCount: 0,
			activeSubagentCount: 0,
			dominantOperationId: null,
			blockingInteractionId: null,
		},
		activeStreamingTail: overrides.activeStreamingTail ?? null,
		lifecycle: overrides.lifecycle ?? {
			status: "ready",
			actionability: {
				canSend: true,
				canResume: false,
				canRetry: false,
				canArchive: false,
				canConfigure: true,
				recommendedAction: "send",
				recoveryPhase: "none",
				compactStatus: "ready",
			},
		},
		capabilities: overrides.capabilities ?? {},
	};
}

describe("promotion-on-open sequence projection", () => {
	let store: SessionStore;

	beforeEach(() => {
		store = new SessionStore();
	});

	it("applies sequence_id from resume snapshot to session metadata", () => {
		store.write.replaceSessionOpenSnapshot(
			createSessionOpenFound({
				requestedSessionId: "discovered-session",
				canonicalSessionId: "discovered-session",
				sequenceId: 5,
			})
		);

		expect(store.read.getSessionMetadata("discovered-session")?.sequenceId).toBe(5);
	});
});
