import { describe, expect, it } from "vitest";

import { shouldRunClaudeCli } from "../entrypoint-mode.js";

describe("shouldRunClaudeCli", () => {
	it("returns false for normal ACP startup with no args", () => {
		expect(shouldRunClaudeCli([])).toBe(false);
	});

	it("returns true for explicit --cli mode", () => {
		expect(shouldRunClaudeCli(["--cli"])).toBe(true);
	});

	it("returns true for SDK stream-json argv pair mode", () => {
		expect(
			shouldRunClaudeCli(["--output-format", "stream-json", "--input-format", "stream-json"])
		).toBe(true);
	});

	it("returns true for SDK stream-json argv equals mode", () => {
		expect(shouldRunClaudeCli(["--output-format=stream-json", "--input-format=stream-json"])).toBe(
			true
		);
	});

	it("returns false when stream-json pair is incomplete", () => {
		expect(shouldRunClaudeCli(["--output-format", "stream-json"])).toBe(false);
		expect(shouldRunClaudeCli(["--input-format", "stream-json"])).toBe(false);
	});
});
