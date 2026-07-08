/**
 * ContentScrollRevealController — owns the agent panel's content scroll-position
 * flags (bound from the scroll viewport), the token-reveal settle revision, and
 * the pending-user-reveal request version, hoisted out of the
 * `agent-panel.svelte` god controller. The fragile scroll/token-reveal $effects
 * and timer stay in the component and drive this via getters/setters — moving
 * the state does not change effect timing. (Continues plan 2026-05-29-002.)
 */
export class ContentScrollRevealController {
	#isAtBottom = $state(true);
	#isAtTop = $state(true);
	#hasUnreadBelow = $state(false);
	#isStreaming = $state(false);
	#settleRevision = $state(0);
	#userRevealRequestVersion = $state(0);

	// Scroll-position flags are `bind:`-bound to the content viewport child, so
	// they expose writable accessors.
	get isAtBottom(): boolean {
		return this.#isAtBottom;
	}
	set isAtBottom(value: boolean) {
		this.#isAtBottom = value;
	}

	get isAtTop(): boolean {
		return this.#isAtTop;
	}
	set isAtTop(value: boolean) {
		this.#isAtTop = value;
	}

	get hasUnreadBelow(): boolean {
		return this.#hasUnreadBelow;
	}
	set hasUnreadBelow(value: boolean) {
		this.#hasUnreadBelow = value;
	}

	get isStreaming(): boolean {
		return this.#isStreaming;
	}
	set isStreaming(value: boolean) {
		this.#isStreaming = value;
	}

	/** Token-reveal settle revision — bumped by the settle timer to force a recompute. */
	get settleRevision(): number {
		return this.#settleRevision;
	}
	setSettleRevision(value: number): void {
		this.#settleRevision = value;
	}

	get userRevealRequestVersion(): number {
		return this.#userRevealRequestVersion;
	}

	/** Bump and return the pending-user-reveal request version. */
	requestUserReveal(): number {
		this.#userRevealRequestVersion += 1;
		return this.#userRevealRequestVersion;
	}
}
