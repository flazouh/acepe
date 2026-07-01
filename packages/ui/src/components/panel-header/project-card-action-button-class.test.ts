import { describe, expect, test } from "vitest";

import { PROJECT_CARD_ACTION_BUTTON_CLASS } from "./project-card-action-button-class.js";

describe("PROJECT_CARD_ACTION_BUTTON_CLASS", () => {
	test("mutes project card action icons until hover or focus", () => {
		expect(PROJECT_CARD_ACTION_BUTTON_CLASS).toContain("text-muted-foreground/35");
		expect(PROJECT_CARD_ACTION_BUTTON_CLASS).toContain("[&_svg]:text-muted-foreground/35");
		expect(PROJECT_CARD_ACTION_BUTTON_CLASS).toContain("hover:text-foreground");
		expect(PROJECT_CARD_ACTION_BUTTON_CLASS).toContain("hover:[&_svg]:text-foreground");
		expect(PROJECT_CARD_ACTION_BUTTON_CLASS).toContain("focus-visible:text-foreground");
		expect(PROJECT_CARD_ACTION_BUTTON_CLASS).toContain("focus-visible:[&_svg]:text-foreground");
	});
});
