import { describe, expect, it } from "bun:test";

import {
	selectorPanelContentClass,
	selectorPanelFilterInputClass,
	selectorPanelFilterRowClass,
	selectorPanelItemClass,
} from "./selector-panel.classes.js";

describe("selector panel spacing", () => {
	it("keeps compact controls inset from the panel edge", () => {
		expect(selectorPanelContentClass).toContain("!p-1");
		expect(selectorPanelFilterRowClass).toContain("px-1");
		expect(selectorPanelItemClass).toContain("py-1");
		expect(selectorPanelItemClass).not.toContain("py-1.5");
	});

	it("uses compact search typography", () => {
		expect(selectorPanelFilterInputClass).toContain("h-6");
		expect(selectorPanelFilterInputClass).toContain("text-xs");
	});
});
