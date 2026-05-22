import { describe, expect, it } from "bun:test";

import {
	formatAgentPanelBoundaryError,
	normalizeAgentPanelBoundaryError,
} from "../agent-panel-host-boundary-error.js";

describe("agent panel host boundary error", () => {
	it("keeps real Error objects", () => {
		const error = new Error("Already normalized");

		expect(normalizeAgentPanelBoundaryError(error)).toBe(error);
	});

	it("normalizes strings and unknown values", () => {
		expect(normalizeAgentPanelBoundaryError("Boom").message).toBe("Boom");
		expect(normalizeAgentPanelBoundaryError("").message).toBe("Unknown agent panel error");
		expect(normalizeAgentPanelBoundaryError(null).message).toBe("Unknown agent panel error");
	});

	it("normalizes error-like objects and preserves backend reference fields", () => {
		const error = normalizeAgentPanelBoundaryError({
			name: "RenderError",
			message: "Panel failed",
			stack: "RenderError: Panel failed\n at component",
			backendCorrelationId: "corr-1",
			backendEventId: "event-1",
		}) as Error & {
			backendCorrelationId?: string;
			backendEventId?: string;
		};

		expect(error.name).toBe("RenderError");
		expect(error.message).toBe("Panel failed");
		expect(error.stack).toContain("at component");
		expect(error.backendCorrelationId).toBe("corr-1");
		expect(error.backendEventId).toBe("event-1");
	});

	it("formats messages and trims duplicate stack headers", () => {
		const error = new Error("Panel failed");
		error.stack = "Error: Panel failed\n at first\n at second";

		expect(formatAgentPanelBoundaryError(error)).toBe(
			"Panel failed\n\nStack trace:\n at first\n at second"
		);
	});

	it("includes custom error names and caps stack output", () => {
		const error = new Error("Panel failed");
		error.name = "RenderError";
		error.stack = [
			"RenderError: Panel failed",
			...Array.from({ length: 35 }, (_, index) => ` at line ${index + 1}`),
		].join("\n");

		const formatted = formatAgentPanelBoundaryError(error);

		expect(formatted.startsWith("RenderError: Panel failed\n\nStack trace:")).toBe(true);
		expect(formatted).toContain(" at line 30");
		expect(formatted).not.toContain(" at line 31");
	});
});
