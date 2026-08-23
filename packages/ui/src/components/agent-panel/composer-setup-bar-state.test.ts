import { describe, expect, it } from "bun:test";

import { composerSetupBarIsEmpty } from "./composer-setup-bar-state.ts";

describe("composerSetupBarIsEmpty", () => {
	it("is true only when skills, servers, and options are all absent", () => {
		expect(
			composerSetupBarIsEmpty({
				skills: [],
				servers: [],
				optionCount: 0,
			}),
		).toBe(true);
		expect(
			composerSetupBarIsEmpty({
				skills: [{ id: "issue-244-review", name: "issue-244-review" }],
				servers: [],
				optionCount: 0,
			}),
		).toBe(false);
	});
});
