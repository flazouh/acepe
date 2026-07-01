import { describe, expect, test } from "vitest";

import { PLUS_ACTION_BUTTON_CLASS } from "./plus-icon-classes.js";

describe("PLUS_ACTION_BUTTON_CLASS", () => {
	test("mutes standalone plus actions until hover or focus", () => {
		expect(PLUS_ACTION_BUTTON_CLASS).toContain("text-muted-foreground/35");
		expect(PLUS_ACTION_BUTTON_CLASS).toContain("[&_svg]:text-muted-foreground/35");
		expect(PLUS_ACTION_BUTTON_CLASS).toContain("hover:text-foreground");
		expect(PLUS_ACTION_BUTTON_CLASS).toContain("hover:[&_svg]:text-foreground");
		expect(PLUS_ACTION_BUTTON_CLASS).toContain("focus-visible:text-foreground");
		expect(PLUS_ACTION_BUTTON_CLASS).toContain("focus-visible:[&_svg]:text-foreground");
	});
});
