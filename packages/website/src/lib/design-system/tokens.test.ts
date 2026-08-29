import { describe, expect, test } from "vitest";

import { colorGroups } from "./tokens.js";

describe("design-system token catalogue", () => {
	test("group ids are unique so the nav can anchor to them", () => {
		const ids = colorGroups.map((group) => group.id);

		expect(new Set(ids).size).toBe(ids.length);
	});
});
