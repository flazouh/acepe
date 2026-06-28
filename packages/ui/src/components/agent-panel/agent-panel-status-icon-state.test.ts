import { describe, expect, it } from "vitest";

import { resolveAgentPanelStatusIconPresentation } from "./agent-panel-status-icon-state.js";

describe("resolveAgentPanelStatusIconPresentation", () => {
	it("renders no loading affordance during warming", () => {
		expect(
			resolveAgentPanelStatusIconPresentation({
				status: "warming",
				isConnecting: false,
				isRetrying: false,
			})
		).toBe("none");
	});

	it("renders no loading affordance while connecting before a session exists", () => {
		expect(
			resolveAgentPanelStatusIconPresentation({
				status: "empty",
				isConnecting: true,
				isRetrying: false,
			})
		).toBe("none");
	});

	it("shows loading feedback after the user clicks retry", () => {
		expect(
			resolveAgentPanelStatusIconPresentation({
				status: "error",
				isConnecting: false,
				isRetrying: true,
			})
		).toBe("loading");
	});

	it("keeps the error affordance visible", () => {
		expect(
			resolveAgentPanelStatusIconPresentation({
				status: "error",
				isConnecting: false,
				isRetrying: false,
			})
		).toBe("error");
	});

	it("keeps the connected affordance visible", () => {
		expect(
			resolveAgentPanelStatusIconPresentation({
				status: "connected",
				isConnecting: false,
				isRetrying: false,
			})
		).toBe("connected");
	});
});
