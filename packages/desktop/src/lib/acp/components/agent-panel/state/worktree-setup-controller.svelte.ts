/**
 * WorktreeSetupController — owns the agent panel's worktree-setup card state
 * (the WorktreeSetupState driven by the git-worktree-setup Tauri channel),
 * hoisted out of the `agent-panel.svelte` god controller so the create/reduce/
 * clear transitions are unit-testable. The reactive $effects that subscribe to
 * the channel + prune orphaned state stay in the component and drive this via
 * its mutators. (Continues plan 2026-05-29-002.)
 */
import { createWorktreeCreationState, reduceWorktreeSetupEvent } from "../logic/index.js";
import type { WorktreeSetupState } from "../logic/worktree-setup-events.js";

export class WorktreeSetupController {
	#state = $state<WorktreeSetupState | null>(null);

	get state(): WorktreeSetupState | null {
		return this.#state;
	}

	/** Begin showing the creating-worktree card. */
	startCreation(options: Parameters<typeof createWorktreeCreationState>[0]): void {
		this.#state = createWorktreeCreationState(options);
	}

	/** Fold a worktree-setup channel event into the current state. */
	applyEvent(event: Parameters<typeof reduceWorktreeSetupEvent>[1]): void {
		this.#state = reduceWorktreeSetupEvent(this.#state, event);
	}

	clear(): void {
		this.#state = null;
	}
}
