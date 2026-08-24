/**
 * Decides whether the transcript-rows bootstrap request should fire for the
 * current render of `scene-content-viewport.svelte`.
 *
 * A freshly (deferred-)created session gets a `sessionId` well before Rust
 * emits its first `SessionStateGraph` envelope, so `hasCanonicalGraphRevision`
 * can be false for one or more reactive ticks after `sessionId` first becomes
 * non-null. `TranscriptRowsController.ensureRowsBootstrap` silently no-ops in
 * that window (it needs a graph revision to build the viewport-buffer
 * request), so the caller must not mark the session "bootstrapped" until the
 * canonical revision is actually present — otherwise the request never fires
 * again and the panel stays empty even after canonical state materializes.
 *
 * `SessionOpenHydrator` (the "open a saved session" path) never hits this
 * race: it calls `replaceSessionStateGraph` before `ensureRowsBootstrap`, so
 * the revision already exists by the time it bootstraps. This gate exists so
 * the reactive, freshly-created-session path gets the same guarantee.
 */
export interface TranscriptRowsBootstrapGateInput {
	readonly skipRowsBootstrap: boolean;
	readonly sessionId: string | null;
	readonly bootstrappedSessionId: string | null;
	readonly hasCanonicalGraphRevision: boolean;
}

export function shouldBootstrapTranscriptRows(input: TranscriptRowsBootstrapGateInput): boolean {
	if (input.skipRowsBootstrap) {
		return false;
	}
	if (input.sessionId === null) {
		return false;
	}
	if (input.sessionId === input.bootstrappedSessionId) {
		return false;
	}
	return input.hasCanonicalGraphRevision;
}
