import { describe, expect, it } from "bun:test";

import { PanelConnectionState } from "../../../../types/panel-connection-state";
import { derivePanelErrorInfo } from "../connection-ui";

describe("derivePanelErrorInfo", () => {
	it("returns panel error details when panel connection fails", () => {
		const result = derivePanelErrorInfo({
			panelConnectionState: PanelConnectionState.ERROR,
			panelConnectionError: "npm error 404",
			sessionConnectionError: null,
		});

		expect(result.showError).toBe(true);
		expect(result.details).toBe("npm error 404");
	});

	it("returns session error details when session connection fails", () => {
		const result = derivePanelErrorInfo({
			panelConnectionState: PanelConnectionState.CONNECTING,
			panelConnectionError: null,
			sessionConnectionError: "Failed to resume session",
		});

		expect(result.showError).toBe(true);
		expect(result.details).toBe("Failed to resume session");
	});

	it("prefers panel error details when both are present", () => {
		const result = derivePanelErrorInfo({
			panelConnectionState: PanelConnectionState.ERROR,
			panelConnectionError: "Panel error",
			sessionConnectionError: "Session error",
		});

		expect(result.showError).toBe(true);
		expect(result.details).toBe("Panel error");
	});

	it("returns no error when neither source reports failure", () => {
		const result = derivePanelErrorInfo({
			panelConnectionState: PanelConnectionState.CONNECTING,
			panelConnectionError: null,
			sessionConnectionError: null,
		});

		expect(result.showError).toBe(false);
		expect(result.details).toBe(null);
	});
});
