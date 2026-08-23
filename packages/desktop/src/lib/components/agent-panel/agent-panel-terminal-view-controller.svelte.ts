import type { ProjectedTerminal } from "@acepe/contracts";

export type TerminalRenderInstruction =
	| { readonly kind: "reset"; readonly text: string }
	| { readonly kind: "delta"; readonly text: string };

/**
 * Owns the reactive view state for one terminal view instance: the plain-text
 * output mirror, the closed flag, and the last error message. xterm/DOM
 * wiring (the Terminal instance, container element, resize observer) stays in
 * agent-panel-terminal-view.svelte; this class holds only the reactive view
 * model and the pure rules that were racy/sticky before this fix:
 *
 *  - input buffering until `terminal.open` has round-tripped. Keystrokes that
 *    reach the RPC layer before the terminal is registered fail with
 *    "No open terminal registered for '<id>'" and are lost for good, so
 *    `submitInput` buffers them and `markOpenReady` flushes the buffer in
 *    order once open has succeeded.
 *  - error-state clearing on the next successful dispatch or poll tick, so a
 *    transient error does not stay displayed forever once things recover.
 */
export class TerminalViewController {
	lastOutputText = $state("");
	closed = $state(false);
	lastError = $state<string | null>(null);

	#renderedLength = 0;
	#openReady = false;
	#pendingInput: string[] = [];

	/**
	 * Folds a terminal snapshot into view state and reports what xterm needs
	 * to write. Returns null when there is nothing new to render (empty/no-op
	 * snapshot). Clears any stale error, since a snapshot only reaches here
	 * after a successful poll tick.
	 */
	applySnapshot(snapshot: ProjectedTerminal | null): TerminalRenderInstruction | null {
		if (snapshot === null) {
			return null;
		}
		this.lastOutputText = snapshot.output;
		this.closed = snapshot.closed;
		this.lastError = null;
		if (snapshot.output.length < this.#renderedLength) {
			// The server-side ring buffer dropped the front (TERMINAL_OUTPUT_CAP):
			// there is no valid delta, so redraw from scratch.
			this.#renderedLength = snapshot.output.length;
			return { kind: "reset", text: snapshot.output };
		}
		const delta = snapshot.output.slice(this.#renderedLength);
		this.#renderedLength = snapshot.output.length;
		if (delta.length === 0) {
			return null;
		}
		return { kind: "delta", text: delta };
	}

	reportError(cause: unknown): void {
		this.lastError = String(cause).slice(0, 300);
	}

	/** Call after a terminal.input dispatch resolves successfully. */
	markInputSucceeded(): void {
		this.lastError = null;
	}

	/**
	 * Called for every keystroke. Before `terminal.open` has round-tripped,
	 * buffers the raw payload instead of returning it for dispatch. Returns
	 * the payloads that are safe to dispatch right now, in arrival order
	 * (either `[data]` once open is ready, or `[]` while buffering).
	 */
	submitInput(data: string): readonly string[] {
		if (this.#openReady) {
			return [data];
		}
		this.#pendingInput.push(data);
		return [];
	}

	/**
	 * Marks the terminal as open and returns everything buffered by
	 * `submitInput` while waiting, in arrival order, so the caller can flush
	 * it before treating later input as immediate.
	 */
	markOpenReady(): readonly string[] {
		this.#openReady = true;
		const flushed = this.#pendingInput;
		this.#pendingInput = [];
		return flushed;
	}
}
