import { describe, expect, test } from "bun:test";

import { BRANCH_PREFIXES, DEFAULT_BRANCH_PREFIX } from "./branch-prefix-options.js";

describe("BRANCH_PREFIXES", () => {
	test("uses exact rounded aliases for matching branch prefixes", () => {
		const prefixesByLabel = new Map(BRANCH_PREFIXES.map((prefix) => [prefix.label, prefix]));

		expect(DEFAULT_BRANCH_PREFIX.iconName).toBe("branch");
		expect(prefixesByLabel.get("None")?.iconName).toBe("branch");
		expect(prefixesByLabel.get("fix")?.iconName).toBe("bug");
		expect(prefixesByLabel.get("feat")?.iconName).toBe("sparkle");
		expect(prefixesByLabel.get("test")?.iconName).toBe("flask");
	});
});
