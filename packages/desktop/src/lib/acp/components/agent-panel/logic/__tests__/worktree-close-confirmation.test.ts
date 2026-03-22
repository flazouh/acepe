import { describe, expect, it } from "bun:test";

import {
	createPendingWorktreeCloseConfirmationState,
	createResolvedWorktreeCloseConfirmationState,
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
});
