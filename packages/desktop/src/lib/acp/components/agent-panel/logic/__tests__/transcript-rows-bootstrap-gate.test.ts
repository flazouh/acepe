import { describe, expect, it } from "vitest";
import { shouldBootstrapTranscriptRows } from "../transcript-rows-bootstrap-gate.js";

describe("shouldBootstrapTranscriptRows", () => {
	it("withholds bootstrap for a freshly-created session with no canonical graph revision yet", () => {
		// This is the fresh-session-transcript bug: sessionId exists (session
		// was just created) but Rust hasn't emitted a SessionStateGraph
		// envelope yet, so requesting rows now would be a silent no-op in
		// TranscriptRowsController that never gets retried.
		expect(
			shouldBootstrapTranscriptRows({
				skipRowsBootstrap: false,
				sessionId: "session-fresh",
				bootstrappedSessionId: null,
				hasCanonicalGraphRevision: false,
			})
		).toBe(false);
	});

	it("bootstraps once the canonical graph revision materializes for that same session", () => {
		expect(
			shouldBootstrapTranscriptRows({
				skipRowsBootstrap: false,
				sessionId: "session-fresh",
				bootstrappedSessionId: null,
				hasCanonicalGraphRevision: true,
			})
		).toBe(true);
	});

	it("does not re-bootstrap a session already marked bootstrapped", () => {
		expect(
			shouldBootstrapTranscriptRows({
				skipRowsBootstrap: false,
				sessionId: "session-1",
				bootstrappedSessionId: "session-1",
				hasCanonicalGraphRevision: true,
			})
		).toBe(false);
	});

	it("does not bootstrap when there is no session", () => {
		expect(
			shouldBootstrapTranscriptRows({
				skipRowsBootstrap: false,
				sessionId: null,
				bootstrappedSessionId: null,
				hasCanonicalGraphRevision: true,
			})
		).toBe(false);
	});

	it("respects the synthetic-override skip flag regardless of revision state", () => {
		expect(
			shouldBootstrapTranscriptRows({
				skipRowsBootstrap: true,
				sessionId: "session-1",
				bootstrappedSessionId: null,
				hasCanonicalGraphRevision: true,
			})
		).toBe(false);
	});

	it("retries a session that previously failed to bootstrap under an older session id, once switched back", () => {
		// bootstrappedSessionId reflects the *last* session marked bootstrapped,
		// so switching panels and back should still gate correctly on revision.
		expect(
			shouldBootstrapTranscriptRows({
				skipRowsBootstrap: false,
				sessionId: "session-a",
				bootstrappedSessionId: "session-b",
				hasCanonicalGraphRevision: false,
			})
		).toBe(false);
	});
});
