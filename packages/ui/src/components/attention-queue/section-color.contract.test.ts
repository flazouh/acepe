import { describe, expect, it } from "bun:test";

import { sectionColor } from "./section-color.js";

describe("sectionColor", () => {
	it("uses the build icon token for working and semantic success for finished", () => {
		expect(sectionColor("working")).toBe("var(--build-icon)");
		expect(sectionColor("finished")).toBe("var(--success-reference)");
	});
});
