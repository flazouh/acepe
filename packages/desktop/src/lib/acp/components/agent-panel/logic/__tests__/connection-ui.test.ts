import { describe, expect, it } from "bun:test";

import { PanelConnectionState } from "../../../../types/panel-connection-state";
import { derivePanelErrorInfo, shouldShowInlinePanelError } from "../connection-ui";

describe("derivePanelErrorInfo", () => {
	it("returns panel error details when panel connection fails", () => {
		const result = derivePanelErrorInfo({
			panelConnectionState: PanelConnectionState.ERROR,
			panelConnectionError: {
				message: "npm error 404",
				referenceId: "ref-123",
				referenceSearchable: true,
			},
			sessionConnectionError: null,
			activeTurnError: null,
			sessionFailureReason: null,
			agentDisplayName: null,
		});

		expect(result.showError).toBe(true);
		expect(result.title).toBe("Connection error");
		expect(result.summary).toBe("npm error 404");
		expect(result.details).toBe("npm error 404");
		expect(result.referenceId).toBe("ref-123");
		expect(result.referenceSearchable).toBe(true);
		expect(result.failureReason).toBeNull();
	});

	it("renders raw panel error message when there is no curated failure copy", () => {
		// Auth errors no longer flow through failureReason — they are surfaced as
		// a separate signInRequirement signal (Slice 1: pre-session hot-state;
		// Slice 2: canonical Detached(AwaitingAuthentication) lifecycle). This
		// ensures non-auth panel errors still surface their raw message.
		const result = derivePanelErrorInfo({
			panelConnectionState: PanelConnectionState.ERROR,
			panelConnectionError: {
				message: "Failed to create session (ProviderFailedBeforeId): subprocess spawn failed",
				failureReason: null,
			},
			sessionConnectionError: null,
			activeTurnError: null,
			sessionFailureReason: null,
			agentDisplayName: "Cursor",
		});

		expect(result.showError).toBe(true);
		expect(result.failureReason).toBeNull();
		expect(result.details).toBe(
			"Failed to create session (ProviderFailedBeforeId): subprocess spawn failed"
		);
	});

	it("keeps the raw panel message when the panel error has no failure reason", () => {
		const result = derivePanelErrorInfo({
			panelConnectionState: PanelConnectionState.ERROR,
			panelConnectionError: {
				message: "npm error 404",
				failureReason: null,
			},
			sessionConnectionError: null,
			activeTurnError: null,
			sessionFailureReason: null,
			agentDisplayName: "Cursor",
		});

		expect(result.details).toBe("npm error 404");
		expect(result.failureReason).toBeNull();
	});

	it("returns session error details when session connection fails", () => {
		const result = derivePanelErrorInfo({
			panelConnectionState: PanelConnectionState.CONNECTING,
			panelConnectionError: null,
			sessionConnectionError: "Failed to resume session",
			activeTurnError: null,
			sessionFailureReason: null,
			agentDisplayName: null,
		});

		expect(result.showError).toBe(true);
		expect(result.title).toBe("Connection error");
		expect(result.summary).toBe("Failed to resume session");
		expect(result.details).toBe("Failed to resume session");
		expect(result.referenceId).toBeNull();
		expect(result.failureReason).toBeNull();
	});

	it("substitutes curated copy when canonical lifecycle classifies the failure", () => {
		const result = derivePanelErrorInfo({
			panelConnectionState: PanelConnectionState.CONNECTING,
			panelConnectionError: null,
			sessionConnectionError: "JSON-RPC error -32002 Resource not found Session abc",
			activeTurnError: null,
			sessionFailureReason: "sessionGoneUpstream",
			agentDisplayName: "GitHub Copilot",
		});

		expect(result.showError).toBe(true);
		expect(result.details).toBe(
			"This GitHub Copilot session is no longer available to reopen. Start a new session to continue."
		);
		expect(result.failureReason).toBe("sessionGoneUpstream");
	});

	it("turns upstream archived sessions into an unarchive recovery action", () => {
		const result = derivePanelErrorInfo({
			panelConnectionState: PanelConnectionState.CONNECTING,
			panelConnectionError: null,
			sessionConnectionError:
				'thread/resume failed: {"code":-32600,"message":"session 019f2019 is archived. Run `codex unarchive 019f2019` to unarchive it first."}',
			activeTurnError: null,
			sessionFailureReason: "sessionArchivedUpstream",
			agentDisplayName: "Codex Agent",
		});

		expect(result.showError).toBe(true);
		expect(result.title).toBe("Session archived");
		expect(result.summary).toBeNull();
		expect(result.details).toBeNull();
		expect(result.failureReason).toBe("sessionArchivedUpstream");
		expect(result.recoveryAction).toBe("unarchive");
	});

	it("shows raw resume error when the failure reason has no curated copy (resumeFailed)", () => {
		// Authentication errors on the resume path now surface as
		// Detached(AwaitingAuthentication) and are rendered via signInRequirement,
		// not as a connection error. This test covers the remaining case where a
		// generic resumeFailed falls back to raw provider text.
		const result = derivePanelErrorInfo({
			panelConnectionState: PanelConnectionState.CONNECTING,
			panelConnectionError: null,
			sessionConnectionError: "JSON-RPC error -32000 Internal server error",
			activeTurnError: null,
			sessionFailureReason: "resumeFailed",
			agentDisplayName: "Cursor",
		});

		expect(result.showError).toBe(true);
		expect(result.failureReason).toBe("resumeFailed");
		expect(result.details).toBe("JSON-RPC error -32000 Internal server error");
	});

	it("falls back to raw text when the failure reason has no curated copy", () => {
		const result = derivePanelErrorInfo({
			panelConnectionState: PanelConnectionState.CONNECTING,
			panelConnectionError: null,
			sessionConnectionError: "Transient connection blip",
			activeTurnError: null,
			sessionFailureReason: "resumeFailed",
			agentDisplayName: "GitHub Copilot",
		});

		expect(result.details).toBe("Transient connection blip");
		expect(result.failureReason).toBe("resumeFailed");
	});

	it("prefers panel error details when both are present", () => {
		const result = derivePanelErrorInfo({
			panelConnectionState: PanelConnectionState.ERROR,
			panelConnectionError: {
				message: "Panel error",
			},
			sessionConnectionError: "Session error",
			activeTurnError: {
				content: "Rate limited",
				kind: "recoverable",
			},
			sessionFailureReason: null,
			agentDisplayName: null,
		});

		expect(result.showError).toBe(true);
		expect(result.title).toBe("Connection error");
		expect(result.details).toBe("Panel error");
	});

	it("returns no error when neither source reports failure", () => {
		const result = derivePanelErrorInfo({
			panelConnectionState: PanelConnectionState.CONNECTING,
			panelConnectionError: null,
			sessionConnectionError: null,
			activeTurnError: null,
			sessionFailureReason: null,
			agentDisplayName: null,
		});

		expect(result.showError).toBe(false);
		expect(result.summary).toBe(null);
		expect(result.details).toBe(null);
		expect(result.referenceId).toBeNull();
		expect(result.failureReason).toBeNull();
	});

	it("returns turn error details when the latest turn failed", () => {
		const result = derivePanelErrorInfo({
			panelConnectionState: PanelConnectionState.CONNECTING,
			panelConnectionError: null,
			sessionConnectionError: null,
			sessionTurnState: "error",
			activeTurnError: {
				content: "Rate limit reached",
				code: "429",
				details: '{\n  "name": "RateLimitError"\n}',
				kind: "recoverable",
				referenceId: "turn-ref",
				referenceSearchable: false,
				source: "json_rpc",
			},
			sessionFailureReason: null,
			agentDisplayName: null,
		});

		expect(result.showError).toBe(true);
		expect(result.title).toBe("Request error");
		expect(result.summary).toBe("Rate limit reached");
		expect(result.details).toBe(
			'Code: 429\n\nSource: json_rpc\n\n{\n  "name": "RateLimitError"\n}'
		);
		expect(result.details).not.toContain("Rate limit reached");
		expect(result.referenceId).toBe("turn-ref");
		expect(result.referenceSearchable).toBe(false);
	});

	it("does not truncate the canonical turn failure message", () => {
		const message = `Provider failure: ${"x".repeat(120)}`;
		const result = derivePanelErrorInfo({
			panelConnectionState: PanelConnectionState.CONNECTING,
			panelConnectionError: null,
			sessionConnectionError: null,
			sessionTurnState: "error",
			activeTurnError: { content: message, kind: "recoverable", source: "unknown" },
			sessionFailureReason: null,
			agentDisplayName: "OpenCode",
		});

		expect(result.summary).toBe(message);
	});

	it("does not offer retry for a fatal turn failure", () => {
		const result = derivePanelErrorInfo({
			panelConnectionState: PanelConnectionState.CONNECTING,
			panelConnectionError: null,
			sessionConnectionError: null,
			sessionTurnState: "error",
			activeTurnError: { content: "Invalid credentials", kind: "fatal", source: "unknown" },
			sessionFailureReason: null,
			agentDisplayName: "OpenCode",
		});

		expect(result.canRetry).toBe(false);
	});

	it("shows a canonical active failure even while turn-state delivery catches up", () => {
		const result = derivePanelErrorInfo({
			panelConnectionState: PanelConnectionState.CONNECTING,
			panelConnectionError: null,
			sessionConnectionError: null,
			sessionTurnState: "idle",
			activeTurnError: {
				content: "Provider request failed",
				kind: "recoverable",
				source: "unknown",
			},
			sessionFailureReason: null,
			agentDisplayName: "Cursor",
		});

		expect(result.showError).toBe(true);
		expect(result.summary).toBe("Provider request failed");
	});
});

describe("shouldShowInlinePanelError", () => {
	it("keeps the failure visible when an errored session still has transcript rows", () => {
		expect(
			shouldShowInlinePanelError({
				showError: true,
				errorDismissed: false,
				viewKind: "error",
				hasTranscript: true,
			})
		).toBe(true);
	});

	it("uses the full-page error instead when the errored session has no transcript", () => {
		expect(
			shouldShowInlinePanelError({
				showError: true,
				errorDismissed: false,
				viewKind: "error",
				hasTranscript: false,
			})
		).toBe(false);
	});
});
