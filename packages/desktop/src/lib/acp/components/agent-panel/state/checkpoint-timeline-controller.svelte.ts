/**
 * CheckpointTimelineController — owns the agent panel's checkpoint-timeline UI
 * state (open/loading + the derived checkpoint list), hoisted out of the
 * `agent-panel.svelte` god controller so it is independently unit-testable.
 *
 * Self-contained: it does not touch the `canonicalPanelSessionState` /
 * `viewState` derivation hubs, so it extracts cleanly as its own controller
 * (complementing AgentPanelSessionController — see
 * docs/plans/2026-05-29-002-...). Reactive `sessionId` is supplied as an
 * accessor so the `checkpoints` $derived recomputes when the session changes.
 */
import type { Checkpoint } from "../../../types/checkpoint.js";

export interface CheckpointTimelineControllerDeps {
	getSessionId: () => string | null;
	getCheckpoints: (sessionId: string) => Checkpoint[];
	loadCheckpoints: (sessionId: string) => Promise<void>;
}

export class CheckpointTimelineController {
	readonly #deps: CheckpointTimelineControllerDeps;
	#isOpen = $state(false);
	#isLoading = $state(false);

	constructor(deps: CheckpointTimelineControllerDeps) {
		this.#deps = deps;
	}

	get isOpen(): boolean {
		return this.#isOpen;
	}

	get isLoading(): boolean {
		return this.#isLoading;
	}

	readonly checkpoints = $derived.by((): Checkpoint[] => {
		const id = this.#deps.getSessionId();
		return id ? this.#deps.getCheckpoints(id) : [];
	});

	/**
	 * Toggle the timeline. Opening loads checkpoints first (showing the loading
	 * state); closing is immediate. No-op without a session — preserves the
	 * original `handleToggleCheckpointTimeline` behavior verbatim.
	 */
	async toggle(): Promise<void> {
		const id = this.#deps.getSessionId();
		if (!id) {
			return;
		}

		if (!this.#isOpen) {
			this.#isLoading = true;
			await this.#deps.loadCheckpoints(id);
			this.#isLoading = false;
		}
		this.#isOpen = !this.#isOpen;
	}

	close(): void {
		this.#isOpen = false;
	}
}
