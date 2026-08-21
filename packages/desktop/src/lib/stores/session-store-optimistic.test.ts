import { describe, expect, it } from "bun:test";

import {
	resolveOptimisticHeaderTitle,
	sessionStoreHeaderTitle,
	sessionStoreView,
	shouldShowClaudeWorkingSpark,
} from "./session-store-optimistic.ts";

describe("optimistic header identity (send-moment == final state)", () => {
	const userMessage = "Reply with only the word hello";

	it("canonical-only header is the generic project placeholder when title is absent", () => {
		expect(
			sessionStoreHeaderTitle({
				canonicalTitle: null,
				pendingUserMessageText: null,
				projectName: "acepe",
			})
		).toBe("Conversation in acepe");
	});

	it("derives the header title from the pending message when no canonical title exists", () => {
		expect(
			resolveOptimisticHeaderTitle({
				canonicalTitle: null,
				pendingUserMessageText: userMessage,
			})
		).toBe(userMessage);
	});

	it("overrides a still-fallback canonical title so the header does not revert", () => {
		expect(
			resolveOptimisticHeaderTitle({
				canonicalTitle: "New Thread",
				pendingUserMessageText: userMessage,
			})
		).toBe(userMessage);
		expect(
			sessionStoreHeaderTitle({
				canonicalTitle: "New Thread",
				pendingUserMessageText: userMessage,
				projectName: "acepe",
			})
		).toBe(userMessage);
	});

	it("defers to a real canonical title once one is promoted", () => {
		expect(
			resolveOptimisticHeaderTitle({
				canonicalTitle: "Renamed by the user",
				pendingUserMessageText: userMessage,
			})
		).toBeNull();
		expect(
			sessionStoreHeaderTitle({
				canonicalTitle: "Renamed by the user",
				pendingUserMessageText: userMessage,
				projectName: "acepe",
			})
		).toBe("Renamed by the user");
	});

	it("returns null when there is no pending message yet", () => {
		expect(
			resolveOptimisticHeaderTitle({
				canonicalTitle: null,
				pendingUserMessageText: null,
			})
		).toBeNull();
	});

	it("derives the title from the first meaningful line", () => {
		expect(
			resolveOptimisticHeaderTitle({
				canonicalTitle: null,
				pendingUserMessageText: "Implement auth flow\nwith OAuth",
			})
		).toBe("Implement auth flow");
	});

	it("returns null for slash-command input", () => {
		expect(
			resolveOptimisticHeaderTitle({
				canonicalTitle: null,
				pendingUserMessageText: "/clear",
			})
		).toBeNull();
	});
});

describe("shouldShowClaudeWorkingSpark", () => {
	it("shows the spark pre-session from the selected agent while canonical id is still null", () => {
		expect(
			shouldShowClaudeWorkingSpark({
				sessionAgentId: null,
				selectedAgentId: "claude-code",
			})
		).toBe(true);
	});

	it("shows the spark from canonical agent id once the session exists", () => {
		expect(
			shouldShowClaudeWorkingSpark({
				sessionAgentId: "claude-code",
				selectedAgentId: null,
			})
		).toBe(true);
	});

	it("does not show the spark for non-Claude agents", () => {
		expect(
			shouldShowClaudeWorkingSpark({
				sessionAgentId: null,
				selectedAgentId: "codex",
			})
		).toBe(false);
	});

	it("does not show the spark when neither identity is known", () => {
		expect(
			shouldShowClaudeWorkingSpark({
				sessionAgentId: null,
				selectedAgentId: null,
			})
		).toBe(false);
	});
});

describe("sessionStoreView", () => {
	it("reads header and spark from snapshot plus send-moment", () => {
		const view = sessionStoreView({
			snapshot: { session: null },
			sendMoment: {
				text: "Reply with only the word hello",
				selectedAgentId: "claude-code",
				projectName: "acepe",
			},
		});
		expect(view.headerTitle).toBe("Reply with only the word hello");
		expect(view.showWorkingSpark).toBe(true);
	});
});
