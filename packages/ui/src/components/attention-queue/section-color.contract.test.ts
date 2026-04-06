import { describe, expect, it } from "bun:test";

import { sectionColor } from "./section-color.js";

describe("sectionColor", () => {
	it("uses the build icon token for working", () => {
		expect(sectionColor("working")).toBe("var(--build-icon)");
	});

	it("gives idle the semantic success color", () => {
		expect(sectionColor("idle")).toBe("var(--success-reference)");
	});
});
