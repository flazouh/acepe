import { describe, expect, it } from "bun:test";

import { Colors } from "../../lib/colors.js";

import { sectionColor } from "./section-color.js";

describe("sectionColor", () => {
	it("uses the build icon token for working and semantic success for finished", () => {
		expect(sectionColor("working")).toBe("var(--build-icon)");
		expect(sectionColor("finished")).toBe("var(--success-reference)");
	});

	it("gives idle its own visible accent color", () => {
		expect(sectionColor("idle")).toBe(Colors.blue);
	});
});
