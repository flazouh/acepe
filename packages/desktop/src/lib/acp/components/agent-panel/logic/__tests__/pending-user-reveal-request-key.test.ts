import { describe, expect, it } from "bun:test";

import { derivePendingUserRevealRequestKey } from "../pending-user-reveal-request-key.js";

describe("derivePendingUserRevealRequestKey", () => {
	it("does not produce a key before a reveal is requested", () => {
		expect(
			derivePendingUserRevealRequestKey({
				panelId: "panel-1",
				userRevealRequestVersion: 0,
			})
		).toBeNull();
	});

	it("depends only on panel and reveal version, not optimistic entry identity", () => {
		expect(
			derivePendingUserRevealRequestKey({
				panelId: "panel-1",
				userRevealRequestVersion: 3,
			})
		).toBe("panel-1:3");
	});
});
