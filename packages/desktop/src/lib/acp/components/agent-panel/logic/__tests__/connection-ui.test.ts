import { describe, expect, it } from "bun:test";

import { PanelConnectionState } from "../../../../types/panel-connection-state";
import { derivePanelErrorInfo } from "../connection-ui";

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
		});

		expect(result.showError).toBe(true);
		expect(result.title).toBe("Connection error");
		expect(result.summary).toBe("npm error 404");
		expect(result.details).toBe("npm error 404");
		expect(result.referenceId).toBe("ref-123");
		expect(result.referenceSearchable).toBe(true);
	});

	it("returns session error details when session connection fails", () => {
		const result = derivePanelErrorInfo({
			panelConnectionState: PanelConnectionState.CONNECTING,
			panelConnectionError: null,
			sessionConnectionError: "Failed to resume session",
			activeTurnError: null,
		});

		expect(result.showError).toBe(true);
		expect(result.title).toBe("Connection error");
		expect(result.summary).toBe("Failed to resume session");
		expect(result.details).toBe("Failed to resume session");
		expect(result.referenceId).toBeNull();
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
		});

		expect(result.showError).toBe(false);
		expect(result.summary).toBe(null);
		expect(result.details).toBe(null);
		expect(result.referenceId).toBeNull();
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
				kind: "recoverable",
				referenceId: "turn-ref",
				referenceSearchable: false,
				source: "json_rpc",
			},
		});

		expect(result.showError).toBe(true);
		expect(result.title).toBe("Request error");
		expect(result.summary).toBe("Rate limit reached");
		expect(result.details).toBe("Rate limit reached\n\nCode: 429\nSource: json_rpc");
		expect(result.referenceId).toBe("turn-ref");
		expect(result.referenceSearchable).toBe(false);
	});
});
