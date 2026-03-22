import { beforeEach, describe, expect, it } from "vitest";

import type { SessionEntry } from "../../../../application/dto/session.js";
import { StickyHeaderLogic } from "../sticky-header-state.svelte.js";
import {
	createAssistantEntry,
	createToolCallEntry,
	createUserEntry,
} from "./session-entry-factories.js";

describe("StickyHeaderLogic", () => {
	let state: StickyHeaderLogic;

	beforeEach(() => {
		state = new StickyHeaderLogic();
	});

	describe("initial state", () => {
		it("has null sticky user message initially", () => {
			expect(state.stickyUserMessage).toBeNull();
		});
	});

	describe("updateEntries", () => {
		it("builds segments when entries are provided", () => {
			const entries: SessionEntry[] = [createUserEntry("u1"), createAssistantEntry("a1")];

			state.updateEntries(entries);

			// We can't directly check private segments, but we can verify behavior via onScroll
			// Scrolling to index 1 (assistant) should show user message in sticky header
			state.onScroll(1, new Set([1]));
			expect(state.stickyUserMessage).not.toBeNull();
			expect(state.stickyUserMessage?.id).toBe("u1");
		});

		it("does not rebuild segments if length unchanged", () => {
			const entries1: SessionEntry[] = [createUserEntry("u1"), createAssistantEntry("a1")];
			const entries2: SessionEntry[] = [
				createUserEntry("u2"), // Different content, same length
				createAssistantEntry("a2"),
			];

			state.updateEntries(entries1);
			state.onScroll(1, new Set([1]));
			const firstUserMsg = state.stickyUserMessage;

			// Update with same-length array - should NOT rebuild
			state.updateEntries(entries2);
			state.onScroll(1, new Set([1]));

			// Still shows old user message because segments weren't rebuilt
			expect(state.stickyUserMessage?.id).toBe(firstUserMsg?.id);
		});

		it("rebuilds segments when length changes", () => {
			const entries1: SessionEntry[] = [createUserEntry("u1"), createAssistantEntry("a1")];

			state.updateEntries(entries1);

			const entries2: SessionEntry[] = [
				createUserEntry("u1"),
				createAssistantEntry("a1"),
				createUserEntry("u2"), // New entry
			];

			state.updateEntries(entries2);
			state.onScroll(2, new Set([2])); // Scroll to new user message

			// Should show null because u2 is visible
			expect(state.stickyUserMessage).toBeNull();
		});
	});

	describe("onScroll", () => {
		it("returns null when no segments exist", () => {
			state.updateEntries([]);
			state.onScroll(0, new Set([0]));

			expect(state.stickyUserMessage).toBeNull();
		});

		it("returns null when user message is visible", () => {
			const userEntry = createUserEntry("u1");
			state.updateEntries([userEntry, createAssistantEntry("a1")]);

			// User message (index 0) is visible
			state.onScroll(0, new Set([0, 1]));

			expect(state.stickyUserMessage).toBeNull();
		});

		it("shows user message when scrolled past it", () => {
			const userEntry = createUserEntry("u1");
			state.updateEntries([
				userEntry,
				createAssistantEntry("a1"),
				createToolCallEntry("t1"),
				createAssistantEntry("a2"),
			]);

			// Scrolled to index 2, only indices 2 and 3 visible
			state.onScroll(2, new Set([2, 3]));

			expect(state.stickyUserMessage).not.toBeNull();
			expect(state.stickyUserMessage?.id).toBe("u1");
		});

		it("hides sticky header when scrolling back to user message", () => {
			const userEntry = createUserEntry("u1");
			state.updateEntries([userEntry, createAssistantEntry("a1"), createAssistantEntry("a2")]);

			// First scroll past user message
			state.onScroll(1, new Set([1, 2]));
			expect(state.stickyUserMessage?.id).toBe("u1");

			// Scroll back to show user message
			state.onScroll(0, new Set([0, 1, 2]));
			expect(state.stickyUserMessage).toBeNull();
		});

		it("updates sticky header when switching segments", () => {
			const user1 = createUserEntry("u1");
			const user2 = createUserEntry("u2");
			state.updateEntries([
				user1,
				createAssistantEntry("a1"),
				createAssistantEntry("a1b"),
				user2,
				createAssistantEntry("a2"),
				createAssistantEntry("a2b"),
			]);

			// Scroll to segment 1 content (past user1)
			state.onScroll(1, new Set([1, 2]));
			expect(state.stickyUserMessage?.id).toBe("u1");

			// Scroll to segment 2 content (past user2)
			state.onScroll(4, new Set([4, 5]));
			expect(state.stickyUserMessage?.id).toBe("u2");
		});

		it("handles scroll position at segment boundary", () => {
			const user1 = createUserEntry("u1");
			const user2 = createUserEntry("u2");
			state.updateEntries([
				user1,
				createAssistantEntry("a1"),
				user2, // index 2
				createAssistantEntry("a2"),
			]);

			// At index 2 (user2), with user2 visible
			state.onScroll(2, new Set([2, 3]));
			expect(state.stickyUserMessage).toBeNull(); // user2 is visible

			// At index 3 (assistant in segment 2), user2 not visible
			state.onScroll(3, new Set([3]));
			expect(state.stickyUserMessage?.id).toBe("u2");
		});

		it("returns null for index outside any segment", () => {
			state.updateEntries([
				createAssistantEntry("a0"), // Orphan before user
				createUserEntry("u1"),
				createAssistantEntry("a1"),
			]);

			// Index 0 is before any segment (no user message owns it)
			state.onScroll(0, new Set([0]));
			expect(state.stickyUserMessage).toBeNull();
		});
	});

	describe("edge cases", () => {
		it("handles single entry conversation", () => {
			const userEntry = createUserEntry("u1");
			state.updateEntries([userEntry]);

			// User message visible
			state.onScroll(0, new Set([0]));
			expect(state.stickyUserMessage).toBeNull();
		});

		it("handles conversation with only user messages", () => {
			const user1 = createUserEntry("u1");
			const user2 = createUserEntry("u2");
			const user3 = createUserEntry("u3");
			state.updateEntries([user1, user2, user3]);

			// At user2, user2 visible
			state.onScroll(1, new Set([1]));
			expect(state.stickyUserMessage).toBeNull();

			// At user3, user3 visible
			state.onScroll(2, new Set([2]));
			expect(state.stickyUserMessage).toBeNull();
		});

		it("handles partial visibility at boundaries", () => {
			const user1 = createUserEntry("u1");
			state.updateEntries([
				user1,
				createAssistantEntry("a1"),
				createAssistantEntry("a2"),
				createAssistantEntry("a3"),
			]);

			// First visible is index 1, but user (0) is also partially visible
			state.onScroll(1, new Set([0, 1, 2]));
			expect(state.stickyUserMessage).toBeNull(); // user is visible

			// First visible is index 1, user not visible
			state.onScroll(1, new Set([1, 2]));
			expect(state.stickyUserMessage?.id).toBe("u1");
		});
	});
});
