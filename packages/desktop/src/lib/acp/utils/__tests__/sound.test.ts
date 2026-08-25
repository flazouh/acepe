import { describe, expect, it } from "bun:test";

import { SoundEffect } from "../../types/sounds.js";

describe("sound catalog", () => {
	it("does not include a startup sound", () => {
		expect(Object.values(SoundEffect)).not.toContain("app-start.wav");
	});
});
