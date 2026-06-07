/**
 * WorktreeCloseConfirmationController — owns the worktree close-confirmation
 * popover state (confirming / hasDirtyChanges / dirtyCheckPending), hoisted out
 * of the `agent-panel.svelte` god controller so it is independently
 * unit-testable. The destructive worktree-removal workflow itself stays in the
 * component; this only owns the confirmation UI state. `confirming` exposes a
 * setter so the popover's `bind:open` keeps working. (Continues plan 2026-05-29-002.)
 */
import {
	createPendingWorktreeCloseConfirmationState,
	createResolvedWorktreeCloseConfirmationState,
} from "../logic/index.js";

export class WorktreeCloseConfirmationController {
	#confirming = $state(false);
	#hasDirtyChanges = $state(false);
	#dirtyCheckPending = $state(false);

	/** Writable so the popover can `bind:open={controller.confirming}`. */
	get confirming(): boolean {
		return this.#confirming;
	}
	set confirming(value: boolean) {
		this.#confirming = value;
	}

	get hasDirtyChanges(): boolean {
		return this.#hasDirtyChanges;
	}

	get dirtyCheckPending(): boolean {
		return this.#dirtyCheckPending;
	}

	/** Open the popover in the pending (dirty-check-in-flight) state. */
	beginPending(): void {
		const state = createPendingWorktreeCloseConfirmationState();
		this.#confirming = state.confirming;
		this.#hasDirtyChanges = state.hasDirtyChanges;
		this.#dirtyCheckPending = state.dirtyCheckPending;
	}

	/** Settle the popover once the dirty check resolves. */
	resolve(hasDirtyChanges: boolean): void {
		const state = createResolvedWorktreeCloseConfirmationState(hasDirtyChanges);
		this.#confirming = state.confirming;
		this.#hasDirtyChanges = state.hasDirtyChanges;
		this.#dirtyCheckPending = state.dirtyCheckPending;
	}

	/** Dismiss after a close/remove action proceeds (leaves hasDirtyChanges intact). */
	dismiss(): void {
		this.#confirming = false;
		this.#dirtyCheckPending = false;
	}

	/** Cancel the confirmation entirely (full reset). */
	cancel(): void {
		this.#confirming = false;
		this.#hasDirtyChanges = false;
		this.#dirtyCheckPending = false;
	}
}
