import { describe, expect, it } from "vitest";

import { deriveAgentPanelHeaderDisplayTitle } from "../agent-panel-header-title.js";
import {
	resolveOptimisticHeaderTitle,
	shouldShowClaudeWorkingSpark,
} from "../pre-session-optimistic-identity.js";

/**
 * Send-moment must equal the final connected state ("optimistic" UI). Video QA
 * showed two distinct defects across the deferred-creation lifecycle:
 *
 *   1. For ~6.5s before a session id existed, the header showed the generic
 *      "Conversation in <project>" + a plain "Planning next moves" placeholder
 *      (no working spark), because title/spark derived only from canonical
 *      identity (null pre-session).
 *   2. After a session id appeared but before canonical materialized
 *      (sourceKind = "missing_canonical"), the header *reverted* to the generic
 *      placeholder because the optimistic title was gated on "no session id".
 *
 * The optimistic title must therefore apply across the whole *pre-canonical*
 * window — keyed on the canonical title being absent or still a fallback, not on
 * the session id — and defer to canonical the instant a real title exists.
 */
describe("optimistic header identity (send-moment == final state)", () => {
	const userMessage = "Reply with only the word hello";

	describe("baseline: the bug the video captured", () => {
		it("canonical-only header is the generic project placeholder when title is absent", () => {
			expect(deriveAgentPanelHeaderDisplayTitle({ sessionTitle: null, projectName: "acepe" })).toBe(
				"Conversation in acepe"
			);
		});
	});

	describe("resolveOptimisticHeaderTitle", () => {
		it("derives the header title from the pending message when no canonical title exists", () => {
			expect(
				resolveOptimisticHeaderTitle({
					canonicalTitle: null,
					pendingUserMessageText: userMessage,
				})
			).toBe(userMessage);
		});

		it("overrides a still-fallback canonical title (e.g. 'New Thread') — fixes the t=2s revert", () => {
			// During the missing_canonical window the early identity record may carry
			// a placeholder title; the optimistic message must win until a real title
			// is promoted, so the header never reverts to a generic label.
			expect(
				resolveOptimisticHeaderTitle({
					canonicalTitle: "New Thread",
					pendingUserMessageText: userMessage,
				})
			).toBe(userMessage);
		});

		it("feeds the header deriver so the whole pre-canonical window reads the message", () => {
			const optimisticTitle = resolveOptimisticHeaderTitle({
				canonicalTitle: null,
				pendingUserMessageText: userMessage,
			});
			const header = deriveAgentPanelHeaderDisplayTitle({
				sessionTitle: optimisticTitle,
				projectName: "acepe",
			});
			expect(header).toBe(userMessage);
			expect(header).not.toBe("Conversation in acepe");
		});

		it("defers to a real canonical title once one is promoted", () => {
			expect(
				resolveOptimisticHeaderTitle({
					canonicalTitle: "Renamed by the user",
					pendingUserMessageText: userMessage,
				})
			).toBeNull();
		});

		it("returns null when there is no pending message yet", () => {
			expect(
				resolveOptimisticHeaderTitle({ canonicalTitle: null, pendingUserMessageText: null })
			).toBeNull();
		});

		it("returns null for slash-command input (not a meaningful title)", () => {
			expect(
				resolveOptimisticHeaderTitle({ canonicalTitle: null, pendingUserMessageText: "/clear" })
			).toBeNull();
		});
	});

	describe("shouldShowClaudeWorkingSpark", () => {
		it("shows the spark pre-session from the selected agent while canonical id is still null", () => {
			expect(
				shouldShowClaudeWorkingSpark({ sessionAgentId: null, selectedAgentId: "claude-code" })
			).toBe(true);
		});

		it("shows the spark from canonical agent id once the session exists", () => {
			expect(
				shouldShowClaudeWorkingSpark({ sessionAgentId: "claude-code", selectedAgentId: null })
			).toBe(true);
		});

		it("does not show the spark for non-Claude agents", () => {
			expect(shouldShowClaudeWorkingSpark({ sessionAgentId: null, selectedAgentId: "codex" })).toBe(
				false
			);
		});

		it("does not show the spark when neither identity is known", () => {
			expect(shouldShowClaudeWorkingSpark({ sessionAgentId: null, selectedAgentId: null })).toBe(
				false
			);
		});
	});
});
