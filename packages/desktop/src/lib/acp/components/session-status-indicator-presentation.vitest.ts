import { describe, expect, it } from "vitest";

import type { SessionStatus } from "../state/index.js";
import { resolveSessionStatusIndicatorPresentation } from "./session-status-indicator-presentation.js";

describe("resolveSessionStatusIndicatorPresentation", () => {
	it("renders no warming spinner during first-send connecting", () => {
		expect(resolveSessionStatusIndicatorPresentation("warming", true)).toBe("none");
	});

	it("keeps the error affordance visible", () => {
		expect(resolveSessionStatusIndicatorPresentation("error", true)).toBe("error");
	});

	it("keeps the connected affordance visible", () => {
		expect(resolveSessionStatusIndicatorPresentation("connected", true)).toBe("connected");
	});

	it("hides all affordances when show is false", () => {
		const statuses: SessionStatus[] = ["warming", "connected", "error"];
		for (const status of statuses) {
			expect(resolveSessionStatusIndicatorPresentation(status, false)).toBe("none");
		}
	});
});
