import { describe, expect, it } from "vitest";

import { SessionIdentityResolver } from "../session-identity-resolver.js";
import { SessionStore } from "../session-store.svelte.js";

function createResolver(sessions: Set<string>): SessionIdentityResolver {
	return new SessionIdentityResolver({
		hasSession: (sessionId) => sessions.has(sessionId),
	});
}

describe("SessionIdentityResolver", () => {
	it("resolves alias to canonical after alias relationship is recorded", () => {
		const sessions = new Set(["C"]);
		const resolver = createResolver(sessions);
		resolver.recordAliasRelationship("A", "C");

		expect(resolver.resolveCanonicalSessionId("A")).toBe("C");
	});

	it("resolves canonical id to itself when session exists", () => {
		const sessions = new Set(["C"]);
		const resolver = createResolver(sessions);

		expect(resolver.resolveCanonicalSessionId("C")).toBe("C");
	});

	it("returns null for unknown ids", () => {
		const resolver = createResolver(new Set());

		expect(resolver.resolveCanonicalSessionId("unknown")).toBeNull();
	});

	it("maps non-alias existing session id to itself", () => {
		const sessions = new Set(["session-1"]);
		const resolver = createResolver(sessions);

		expect(resolver.resolveCanonicalSessionId("session-1")).toBe("session-1");
	});

	it("keeps alias mapping after alias row removal but clears when canonical is removed", () => {
		const sessions = new Set(["A", "C"]);
		const resolver = createResolver(sessions);
		resolver.recordAliasRelationship("A", "C");

		sessions.delete("A");
		expect(resolver.resolveCanonicalSessionId("A")).toBe("C");

		sessions.delete("C");
		expect(resolver.resolveCanonicalSessionId("A")).toBeNull();
	});
});

describe("SessionIdentityResolver with SessionStore", () => {
	it("records alias mapping from open snapshot and survives alias row collapse", () => {
		const store = new SessionStore();
		store.write.replaceSessionOpenSnapshot({
			requestedSessionId: "A",
			canonicalSessionId: "C",
			isAlias: true,
			openPath: "legacy_rebuild",
			lastEventSeq: 1,
			graphRevision: 1,
			openToken: "open-token",
			agentId: "claude-code",
			projectPath: "/repo",
			worktreePath: null,
			sourcePath: "/repo/session.jsonl",
			sequenceId: 2,
			transcriptSnapshot: { revision: 1, entries: [] },
			sessionTitle: "Alias session",
			operations: [],
			interactions: [],
			turnState: "Idle",
			messageCount: 0,
			activity: {
				kind: "idle",
				activeOperationCount: 0,
				activeSubagentCount: 0,
				dominantOperationId: null,
				blockingInteractionId: null,
			},
			activeStreamingTail: null,
			lifecycle: {
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
			capabilities: {},
		});

		expect(store.read.resolveCanonicalSessionId("A")).toBe("C");
		expect(store.read.hasSession("A")).toBe(false);
		expect(store.read.resolveCanonicalSessionId("A")).toBe("C");
	});
});
