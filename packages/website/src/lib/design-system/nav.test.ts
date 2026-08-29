import { describe, expect, test } from "vitest";

import { activeHref, designSystemNav } from "./nav.js";

describe("design-system nav", () => {
	test("a child route does not resolve to the index", () => {
		expect(activeHref("/design-system/components")).toBe("/design-system/components");
	});

	test("the index resolves to itself", () => {
		expect(activeHref("/design-system")).toBe("/design-system");
	});

	test("every link href sits under /design-system", () => {
		const hrefs = designSystemNav.flatMap((section) => section.links.map((link) => link.href));

		expect(hrefs.every((href) => href.startsWith("/design-system"))).toBe(true);
	});
});
