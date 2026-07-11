import { describe, expect, test } from "bun:test";

import {
	linearIconCatalogHash,
	linearIconData,
	linearIconLibrary,
	linearIconNames,
} from "./linear-icons.js";

describe("website linear icon catalog", () => {
	test("exposes the Linear-derived design-system inventory", () => {
		expect(linearIconNames.length).toBeGreaterThan(300);
		expect(linearIconLibrary.length).toBe(linearIconNames.length);
		expect(linearIconCatalogHash).toHaveLength(64);
		expect(linearIconData.close.viewBox).toBe("0 0 16 16");
		expect(linearIconData.close.inner).toContain('fill="currentColor"');
		expect(linearIconLibrary.some((icon) => icon.name === "filter")).toBe(true);
	});
});
