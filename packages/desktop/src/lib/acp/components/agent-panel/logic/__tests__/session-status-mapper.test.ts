import { describe, expect, it } from "bun:test";

import { mapSessionStatusToUI } from "../session-status-mapper";

describe("mapSessionStatusToUI", () => {
	it('should map "idle" to "empty"', () => {
		expect(mapSessionStatusToUI("idle")).toBe("empty");
	});

	it('should map "connecting" to "warming"', () => {
		expect(mapSessionStatusToUI("connecting")).toBe("warming");
	});

	it('should map "ready" to "connected"', () => {
		expect(mapSessionStatusToUI("ready")).toBe("connected");
	});

	it('should map "streaming" to "connected"', () => {
		expect(mapSessionStatusToUI("streaming")).toBe("connected");
	});

	it('should map "error" to "error"', () => {
		expect(mapSessionStatusToUI("error")).toBe("error");
	});

	it('should map undefined to "empty"', () => {
		expect(mapSessionStatusToUI(undefined)).toBe("empty");
	});

	it('should map null to "empty"', () => {
		expect(mapSessionStatusToUI(null)).toBe("empty");
	});

	it('should map unknown status to "empty"', () => {
		expect(mapSessionStatusToUI("loading" as never)).toBe("empty");
	});

	it('should map "paused" to "empty"', () => {
		expect(mapSessionStatusToUI("paused")).toBe("empty");
	});
});
