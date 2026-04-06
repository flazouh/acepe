import { describe, expect, it } from "bun:test";

import {
	createPendingWorktreeCloseConfirmationState,
	createResolvedWorktreeCloseConfirmationState,
	shouldConfirmWorktreeClose,
} from "../worktree-close-confirmation.js";

describe("worktree close confirmation", () => {
	it("enters confirming state immediately while dirty check is pending", () => {
		expect(createPendingWorktreeCloseConfirmationState()).toEqual({
			confirming: true,
			hasDirtyChanges: false,
			dirtyCheckPending: true,
		});
	});

	it("keeps the confirmation open after the dirty check resolves", () => {
		expect(createResolvedWorktreeCloseConfirmationState(true)).toEqual({
			confirming: true,
			hasDirtyChanges: true,
			dirtyCheckPending: false,
		});

		expect(createResolvedWorktreeCloseConfirmationState(false)).toEqual({
			confirming: true,
			hasDirtyChanges: false,
			dirtyCheckPending: false,
		});
	});

	it("lets callers bypass worktree confirmation for dialog-only dismissals", () => {
		expect(
			shouldConfirmWorktreeClose({
				bypassConfirmation: true,
				worktreePath: "/repo/.worktrees/feature-a",
				worktreeDeleted: false,
			})
		).toBe(false);

		expect(
			shouldConfirmWorktreeClose({
				bypassConfirmation: false,
				worktreePath: "/repo/.worktrees/feature-a",
				worktreeDeleted: false,
			})
		).toBe(true);
	});
});
